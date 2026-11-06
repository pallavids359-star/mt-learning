import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../core/config.dart';
import 'models.dart';
import 'secure_store.dart';

/// The server answered with an error the student should see.
class ApiException implements Exception {
  ApiException(this.statusCode, this.message);
  final int statusCode;
  final String message;
  @override
  String toString() => message;
}

/// The server could not be reached (no Wi-Fi, server down, timeout).
class OfflineException implements Exception {
  @override
  String toString() => 'You are offline. Connect to the college Wi-Fi and try again.';
}

/// The session has ended (signed out elsewhere, password reset, account suspended).
class SessionExpiredException implements Exception {
  @override
  String toString() => 'Your session has ended. Please sign in again.';
}

class ApiClient {
  ApiClient({required SecureStore store, http.Client? httpClient, String? baseUrl})
      : _store = store,
        _http = httpClient ?? http.Client(),
        _base = '${baseUrl ?? AppConfig.apiBaseUrl}/api/v1';

  final SecureStore _store;
  final http.Client _http;
  final String _base;

  String? _accessToken;
  Future<bool>? _refreshing;

  bool get hasAccessToken => _accessToken != null;

  // ------------------------------------------------------------ auth

  Future<LoginResult> login({
    required String studentCode,
    required String secret,
    required bool usePin,
    String? deviceSerial,
  }) async {
    final json = await _send('POST', '/auth/student/login', body: {
      'studentCode': studentCode,
      'secret': secret,
      'secretType': usePin ? 'pin' : 'password',
      if (deviceSerial != null && deviceSerial.isNotEmpty) 'deviceSerial': deviceSerial,
    }, auth: false);
    final result = LoginResult.fromJson(json as Map<String, dynamic>);
    _accessToken = result.accessToken;
    await _store.writeRefreshToken(result.refreshToken);
    return result;
  }

  /// Gets a fresh access token from the stored refresh token. Concurrent callers share one request,
  /// because the server treats a reused refresh token as theft.
  Future<bool> refreshSession() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<bool> _doRefresh() async {
    final rt = await _store.readRefreshToken();
    if (rt == null) return false;
    try {
      final json = await _send('POST', '/auth/refresh', body: {'refreshToken': rt}, auth: false);
      final map = json as Map<String, dynamic>;
      _accessToken = map['accessToken'] as String?;
      await _store.writeRefreshToken(map['refreshToken'] as String?);
      return _accessToken != null;
    } on ApiException catch (e) {
      if (e.statusCode == 401) {
        _accessToken = null;
        await _store.writeRefreshToken(null);
        return false;
      }
      rethrow;
    }
  }

  Future<void> logout() async {
    final rt = await _store.readRefreshToken();
    _accessToken = null;
    if (rt != null) {
      try {
        await _send('POST', '/auth/logout', body: {'refreshToken': rt}, auth: false);
      } catch (_) {
        // Signing out locally must work offline; the server session expires on its own.
      }
    }
  }

  Future<void> changePassword(String current, String next) =>
      _authed('POST', '/auth/change-password', body: {'currentPassword': current, 'newPassword': next});

  Future<void> setPin(String currentPassword, String pin) =>
      _authed('POST', '/auth/student/pin', body: {'currentPassword': currentPassword, 'pin': pin});

  // ------------------------------------------------------------ student data

  Future<Map<String, dynamic>> fetchHome() async =>
      (await _authed('GET', '/me/student/home')) as Map<String, dynamic>;

  Future<List<int>?> fetchPhoto() async {
    try {
      final res = await _raw('GET', '/me/student/photo', auth: true);
      return res.statusCode == 200 ? res.bodyBytes : null;
    } catch (_) {
      return null;
    }
  }

  /// Reports the tablet is alive. Returns the server's instruction: NONE or SIGN_OUT_AND_WIPE.
  Future<String> heartbeat({required String serial, String? appVersion, String? androidVersion}) async {
    final r = await _authed('POST', '/me/device/heartbeat', body: {
      'serialNumber': serial,
      if (appVersion != null) 'appVersion': appVersion,
      if (androidVersion != null) 'androidVersion': androidVersion,
    });
    return r is Map && r['action'] is String ? r['action'] as String : 'NONE';
  }

  /// Authenticated GET returning decoded JSON.
  Future<Object?> getJson(String path) => _authed('GET', path);

  /// Authenticated POST returning decoded JSON.
  Future<Object?> postJson(String path, [Map<String, Object?> body = const {}]) => _authed('POST', path, body: body);

  /// Authenticated PUT returning decoded JSON.
  Future<Object?> putJson(String path, [Map<String, Object?> body = const {}]) => _authed('PUT', path, body: body);

  /// Authenticated DELETE.
  Future<Object?> deleteJson(String path) => _authed('DELETE', path);

  /// Headers for streaming media straight from the API (video playback without downloading).
  Future<Map<String, String>> authHeaders() async {
    if (_accessToken == null && !await refreshSession()) throw SessionExpiredException();
    return {'Authorization': 'Bearer $_accessToken'};
  }

  String urlFor(String path) => '$_base$path';

  /// Streams a file to [dest] (via a .part file, renamed when complete) and reports progress 0–1.
  Future<void> download(String path, File dest, {void Function(double)? onProgress}) async {
    Future<http.StreamedResponse> send() async {
      final req = http.Request('GET', Uri.parse('$_base$path'))..headers.addAll(await authHeaders());
      try {
        return await _http.send(req).timeout(AppConfig.requestTimeout);
      } on SocketException {
        throw OfflineException();
      } on TimeoutException {
        throw OfflineException();
      } on http.ClientException {
        throw OfflineException();
      }
    }

    var res = await send();
    if (res.statusCode == 401) {
      await res.stream.drain<void>();
      _accessToken = null;
      if (!await refreshSession()) throw SessionExpiredException();
      res = await send();
    }
    if (res.statusCode != 200) {
      await res.stream.drain<void>();
      throw ApiException(res.statusCode, res.statusCode == 404 ? 'This file is no longer available.' : _fallbackMessage(res.statusCode));
    }
    final part = File('${dest.path}.part');
    final sink = part.openWrite();
    final total = res.contentLength ?? 0;
    var received = 0;
    try {
      await for (final chunk in res.stream.timeout(AppConfig.requestTimeout)) {
        sink.add(chunk);
        received += chunk.length;
        if (total > 0) onProgress?.call(received / total);
      }
      await sink.flush();
      await sink.close();
      await part.rename(dest.path);
    } catch (e) {
      await sink.close().catchError((_) => null);
      if (await part.exists()) await part.delete();
      if (e is TimeoutException || e is SocketException || e is http.ClientException) throw OfflineException();
      rethrow;
    }
  }

  // ------------------------------------------------------------ plumbing

  Future<Object?> _authed(String method, String path, {Map<String, Object?>? body}) async {
    if (_accessToken == null && !await refreshSession()) throw SessionExpiredException();
    try {
      return await _send(method, path, body: body, auth: true);
    } on ApiException catch (e) {
      if (e.statusCode != 401) rethrow;
      if (!await refreshSession()) throw SessionExpiredException();
      return _send(method, path, body: body, auth: true);
    }
  }

  Future<http.Response> _raw(String method, String path, {Map<String, Object?>? body, required bool auth}) async {
    final uri = Uri.parse('$_base$path');
    final headers = <String, String>{'Accept': 'application/json'};
    if (body != null) headers['Content-Type'] = 'application/json';
    if (auth && _accessToken != null) headers['Authorization'] = 'Bearer $_accessToken';
    final req = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) req.body = jsonEncode(body);
    try {
      final streamed = await _http.send(req).timeout(AppConfig.requestTimeout);
      return await http.Response.fromStream(streamed).timeout(AppConfig.requestTimeout);
    } on SocketException {
      throw OfflineException();
    } on TimeoutException {
      throw OfflineException();
    } on http.ClientException {
      throw OfflineException();
    } on HandshakeException {
      throw OfflineException();
    }
  }

  Future<Object?> _send(String method, String path, {Map<String, Object?>? body, required bool auth}) async {
    final res = await _raw(method, path, body: body, auth: auth);
    if (res.statusCode == 204 || res.body.isEmpty) {
      if (res.statusCode >= 400) throw ApiException(res.statusCode, _fallbackMessage(res.statusCode));
      return null;
    }
    Object? decoded;
    try {
      decoded = jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      decoded = null;
    }
    if (res.statusCode >= 400) throw ApiException(res.statusCode, _messageOf(decoded) ?? _fallbackMessage(res.statusCode));
    return decoded;
  }

  static String? _messageOf(Object? body) {
    if (body is Map && body['message'] != null) {
      final m = body['message'];
      if (m is String) return m;
      if (m is List) return m.whereType<String>().join('. ');
    }
    return null;
  }

  static String _fallbackMessage(int status) {
    if (status == 429) return 'Too many attempts. Wait a minute and try again.';
    if (status >= 500) return 'The college server has a problem. Try again later.';
    return 'Something went wrong ($status).';
  }
}
