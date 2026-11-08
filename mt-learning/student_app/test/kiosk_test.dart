import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mt_student/core/app_state.dart';
import 'package:mt_student/core/device_identity.dart';
import 'package:mt_student/core/kiosk.dart';
import 'package:mt_student/data/api_client.dart';
import 'package:mt_student/data/secure_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  AppState newState(SecureStore store) => AppState(
        api: ApiClient(store: store, httpClient: MockClient((_) async => http.Response('{}', 500)), baseUrl: 'http://api'),
        store: store,
        device: DeviceIdentity(),
      );

  test('a tablet without a staff PIN goes back to device setup', () async {
    FlutterSecureStorage.setMockInitialValues({'tablet_serial': 'TAB-1'});
    final state = newState(SecureStore());
    await state.start();
    expect(state.stage, AppStage.deviceSetup);
  });

  test('setup saves the serial and staff PIN, and only that PIN opens the staff panel', () async {
    final store = SecureStore();
    final state = newState(store);
    await state.completeDeviceSetup(' tab-7 ', adminPin: '246810');
    expect(state.tabletSerial, 'TAB-7');
    expect(state.stage, AppStage.signedOut);
    expect(await state.checkAdminPin('246810'), isTrue);
    expect(await state.checkAdminPin('000000'), isFalse);
    expect(await state.checkAdminPin(''), isFalse);
  });

  test('a full wipe keeps the tablet serial and staff PIN', () async {
    final store = SecureStore();
    await store.writeTabletSerial('TAB-9');
    await store.writeAdminPin('135791');
    await store.writeLastStudent(code: 'MT26S0001', name: 'Asha', hasPin: true);
    await store.clearSession(wipe: true);
    expect(await store.readTabletSerial(), 'TAB-9');
    expect(await store.readAdminPin(), '135791');
    expect((await store.readLastStudent()).code, isNull);
  });

  test('kiosk calls do nothing where the Android side is missing', () async {
    expect((await Kiosk.status()).owner, isFalse);
    expect(await Kiosk.lock(), isFalse);
  });

  test('kiosk status is read from the Android side', () async {
    const channel = MethodChannel('in.manchestertech/kiosk');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'status') return {'owner': true, 'locked': true, 'maintenance': false};
      return true;
    });
    final s = await Kiosk.status();
    expect([s.owner, s.locked, s.maintenance], [true, true, false]);
    expect(await Kiosk.unlock(), isTrue);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null);
  });
}
