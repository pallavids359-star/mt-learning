import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core/app_scope.dart';
import 'core/app_state.dart';
import 'core/device_identity.dart';
import 'core/theme.dart';
import 'data/api_client.dart';
import 'data/secure_store.dart';
import 'features/auth/change_password_screen.dart';
import 'features/auth/login_screen.dart';
import 'features/shell/app_shell.dart';
import 'features/setup/device_setup_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations(const [
    DeviceOrientation.portraitUp,
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  final store = SecureStore();
  final state = AppState(api: ApiClient(store: store), store: store, device: DeviceIdentity());
  runApp(StudentApp(state: state));
  await state.start();
}

class StudentApp extends StatelessWidget {
  const StudentApp({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: state,
      child: MaterialApp(
        title: 'Manchester Technologies',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        home: const _StageSwitcher(),
      ),
    );
  }
}

class _StageSwitcher extends StatelessWidget {
  const _StageSwitcher();

  @override
  Widget build(BuildContext context) {
    final stage = AppScope.of(context).stage;
    final Widget screen = switch (stage) {
      AppStage.starting => const _Splash(),
      AppStage.deviceSetup => const DeviceSetupScreen(),
      AppStage.signedOut => const LoginScreen(),
      AppStage.mustChangePassword => const ChangePasswordScreen(),
      AppStage.signedIn => const AppShell(),
    };
    return AnimatedSwitcher(duration: const Duration(milliseconds: 200), child: KeyedSubtree(key: ValueKey(stage), child: screen));
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
