import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Encrypted on-device storage (Android Keystore-backed) for the session, the offline
/// cache, downloaded test papers and answers waiting to upload. Nothing sensitive is
/// written to plain files or SharedPreferences.
class SecureStore {
  SecureStore([FlutterSecureStorage? storage])
      : _s = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true, resetOnError: true),
            );

  final FlutterSecureStorage _s;

  static const _refresh = 'refresh_token';
  static const _tabletSerial = 'tablet_serial';
  static const _lastStudentCode = 'last_student_code';
  static const _lastHasPin = 'last_has_pin';
  static const _lastName = 'last_student_name';
  static const _adminPin = 'admin_pin';

  /// Keys that survive signing out (device setup and the "welcome back" PIN screen).
  static const _keepOnSignOut = {_tabletSerial, _adminPin, _lastStudentCode, _lastHasPin, _lastName};

  /// Keys that belong to the tablet, not a student, so even a full wipe keeps them.
  static const _keepOnWipe = {_tabletSerial, _adminPin};

  Future<String?> readRefreshToken() => _s.read(key: _refresh);
  Future<void> writeRefreshToken(String? v) => v == null ? _s.delete(key: _refresh) : _s.write(key: _refresh, value: v);

  Future<String?> readTabletSerial() => _s.read(key: _tabletSerial);
  Future<void> writeTabletSerial(String v) => _s.write(key: _tabletSerial, value: v);

  /// The staff PIN that unlocks the tablet's kiosk lock. Set by the device administrator at setup.
  Future<String?> readAdminPin() => _s.read(key: _adminPin);
  Future<void> writeAdminPin(String v) => _s.write(key: _adminPin, value: v);

  Future<({String? code, String? name, bool hasPin})> readLastStudent() async => (
        code: await _s.read(key: _lastStudentCode),
        name: await _s.read(key: _lastName),
        hasPin: await _s.read(key: _lastHasPin) == 'true',
      );

  Future<void> writeLastStudent({required String code, String? name, required bool hasPin}) async {
    await _s.write(key: _lastStudentCode, value: code);
    await _s.write(key: _lastHasPin, value: hasPin ? 'true' : 'false');
    if (name != null) await _s.write(key: _lastName, value: name);
  }

  // ------------------------------------------------------------ JSON documents

  Future<Object?> readJson(String key) async {
    final raw = await _s.read(key: key);
    if (raw == null) return null;
    try {
      return jsonDecode(raw);
    } catch (_) {
      return null;
    }
  }

  Future<void> writeJson(String key, Object? value) =>
      value == null ? _s.delete(key: key) : _s.write(key: key, value: jsonEncode(value));

  Future<void> delete(String key) => _s.delete(key: key);

  /// All keys starting with [prefix], e.g. every downloaded test paper.
  Future<Map<String, String>> readPrefix(String prefix) async {
    final all = await _s.readAll();
    return {
      for (final e in all.entries)
        if (e.key.startsWith(prefix)) e.key: e.value,
    };
  }

  /// Signs out: removes the session and everything cached for this student.
  /// Answers waiting to upload are kept unless [wipe] is set (lost tablet, or another student).
  Future<void> clearSession({bool wipe = false}) async {
    final all = await _s.readAll();
    for (final key in all.keys) {
      if (_keepOnSignOut.contains(key) && !(wipe && !_keepOnWipe.contains(key))) continue;
      if (!wipe && key.startsWith('outbox:')) continue;
      await _s.delete(key: key);
    }
  }
}
