import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:http/http.dart' as http;
import 'package:mt_student/core/app_scope.dart';
import 'package:mt_student/core/app_state.dart';
import 'package:mt_student/core/device_identity.dart';
import 'package:mt_student/core/theme.dart';
import 'package:mt_student/data/api_client.dart';
import 'package:mt_student/data/secure_store.dart';
import 'package:mt_student/features/auth/login_screen.dart';

Widget _wrap(AppState state) => AppScope(
      state: state,
      child: MaterialApp(theme: buildTheme(), home: const LoginScreen()),
    );

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets('shows validation messages when fields are empty', (tester) async {
    final store = SecureStore();
    final api = ApiClient(store: store, httpClient: MockClient((_) async => http.Response('{}', 500)), baseUrl: 'http://api');
    await tester.pumpWidget(_wrap(AppState(api: api, store: store, device: DeviceIdentity())));

    await tester.tap(find.byKey(const Key('signIn')));
    await tester.pump();

    expect(find.text('Enter your student ID'), findsOneWidget);
    expect(find.text('Enter your password'), findsOneWidget);
  });

  testWidgets('shows the server message when sign-in is rejected', (tester) async {
    final store = SecureStore();
    final api = ApiClient(
      store: store,
      httpClient: MockClient((_) async => http.Response('{"message":"Invalid credentials"}', 401)),
      baseUrl: 'http://api',
    );
    await tester.pumpWidget(_wrap(AppState(api: api, store: store, device: DeviceIdentity())));

    await tester.enterText(find.byKey(const Key('studentCode')), 'mt26s0001');
    await tester.enterText(find.byKey(const Key('secret')), 'wrong-password1');
    await tester.tap(find.byKey(const Key('signIn')));
    await tester.pumpAndSettle();

    expect(find.text('Invalid credentials'), findsOneWidget);
  });

  testWidgets('switching to PIN changes the field label', (tester) async {
    final store = SecureStore();
    final api = ApiClient(store: store, httpClient: MockClient((_) async => http.Response('{}', 500)), baseUrl: 'http://api');
    await tester.pumpWidget(_wrap(AppState(api: api, store: store, device: DeviceIdentity())));

    await tester.tap(find.text('Use PIN instead'));
    await tester.pump();
    expect(find.text('PIN'), findsOneWidget);
    expect(find.text('Use password instead'), findsOneWidget);
  });
}
