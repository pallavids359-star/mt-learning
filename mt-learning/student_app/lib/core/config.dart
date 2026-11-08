/// Build-time configuration. Pass values with --dart-define, for example:
///   flutter build apk --dart-define=API_BASE_URL=https://api.college.example
class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000', // Android emulator → host machine
  );

  static const Duration requestTimeout = Duration(seconds: 20);

  /// How often the app reports to the server that the tablet is alive.
  static const Duration heartbeatInterval = Duration(minutes: 15);
}
