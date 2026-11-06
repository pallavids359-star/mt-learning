/// Build-time configuration. Pass values with --dart-define, for example:
///   flutter build apk --dart-define=API_BASE_URL=https://api.college.example
class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000', // Android emulator → host machine
  );

  static const Duration requestTimeout = Duration(seconds: 20);

  /// Attendance is kept in the college's Bridge app. This link opens it (the Bridge
  /// Android app handles it if installed and set up for app links, otherwise the browser).
  ///   flutter build apk --dart-define=BRIDGE_URL=https://bridge.college.example
  static const String bridgeUrl = String.fromEnvironment('BRIDGE_URL');

  /// How often the app reports to the server that the tablet is alive.
  static const Duration heartbeatInterval = Duration(minutes: 15);
}
