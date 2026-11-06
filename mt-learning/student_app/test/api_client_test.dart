import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mt_student/data/api_client.dart';
import 'package:mt_student/data/secure_store.dart';

http.Response json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('login stores the refresh token and sends the device serial', () async {
    late Map<String, dynamic> sent;
    final client = MockClient((req) async {
      expect(req.url.path, '/api/v1/auth/student/login');
      sent = jsonDecode(req.body) as Map<String, dynamic>;
      return json({'accessToken': 'a1', 'refreshToken': 'r1-xxxxxxxxxxxxxxxxxxxx', 'mustChangePassword': true, 'hasPin': false});
    });
    final store = SecureStore();
    final api = ApiClient(store: store, httpClient: client, baseUrl: 'http://api');
    final res = await api.login(studentCode: 'MT1', secret: 'pw', usePin: false, deviceSerial: 'SER1');
    expect(res.mustChangePassword, isTrue);
    expect(sent['deviceSerial'], 'SER1');
    expect(sent['secretType'], 'password');
    expect(await store.readRefreshToken(), 'r1-xxxxxxxxxxxxxxxxxxxx');
  });

  test('a 401 triggers exactly one refresh, then the request is retried', () async {
    var refreshes = 0;
    var homeCalls = 0;
    final client = MockClient((req) async {
      if (req.url.path.endsWith('/auth/refresh')) {
        refreshes++;
        return json({'accessToken': 'fresh', 'refreshToken': 'r2-xxxxxxxxxxxxxxxxxxxx'});
      }
      if (req.url.path.endsWith('/me/student/home')) {
        homeCalls++;
        if (req.headers['Authorization'] != 'Bearer fresh') return json({'message': 'expired'}, 401);
        return json({'profile': {'fullName': 'A'}, 'subjects': []});
      }
      return json({}, 404);
    });
    final store = SecureStore();
    await store.writeRefreshToken('r1-xxxxxxxxxxxxxxxxxxxx');
    final api = ApiClient(store: store, httpClient: client, baseUrl: 'http://api');

    // Two concurrent calls share one refresh (the server would treat a second refresh as token reuse).
    await Future.wait([api.fetchHome(), api.fetchHome()]);
    expect(refreshes, 1);
    expect(homeCalls, 2);
    expect(await store.readRefreshToken(), 'r2-xxxxxxxxxxxxxxxxxxxx');
  });

  test('a rejected refresh clears the session and reports it', () async {
    final client = MockClient((req) async => json({'message': 'Session expired'}, 401));
    final store = SecureStore();
    await store.writeRefreshToken('r1-xxxxxxxxxxxxxxxxxxxx');
    final api = ApiClient(store: store, httpClient: client, baseUrl: 'http://api');
    await expectLater(api.fetchHome(), throwsA(isA<SessionExpiredException>()));
    expect(await store.readRefreshToken(), isNull);
  });

  test('network failures become OfflineException', () async {
    final client = MockClient((req) async => throw http.ClientException('no route'));
    final api = ApiClient(store: SecureStore(), httpClient: client, baseUrl: 'http://api');
    await expectLater(
      api.login(studentCode: 'X', secret: 'y', usePin: false),
      throwsA(isA<OfflineException>()),
    );
  });

  test('server validation messages are surfaced to the student', () async {
    final client = MockClient((req) async => json({'message': ['PIN must be 4–6 digits']}, 400));
    final api = ApiClient(store: SecureStore(), httpClient: client, baseUrl: 'http://api');
    await expectLater(
      api.login(studentCode: 'X', secret: '1', usePin: true),
      throwsA(isA<ApiException>().having((e) => e.message, 'message', 'PIN must be 4–6 digits')),
    );
  });
}
