import 'package:flutter/services.dart';

/// What the tablet's kiosk lock is doing right now.
class KioskStatus {
  const KioskStatus({required this.owner, required this.locked, required this.maintenance});

  /// The app is the tablet's device owner, so it can lock the tablet (set up once with adb).
  final bool owner;

  /// The tablet is locked to this app.
  final bool locked;

  /// Staff unlocked it with the admin PIN; it locks again when the app restarts.
  final bool maintenance;

  static const none = KioskStatus(owner: false, locked: false, maintenance: false);
}

/// Kiosk mode: the tablet runs only MT Learning (Android lock task mode). The lock itself is
/// in the Android code (MainActivity.kt), which locks the tablet every time the app opens.
/// These calls let staff unlock it, open Wi-Fi settings, or remove kiosk mode for good.
/// On anything that is not an Android tablet set up for kiosk mode they do nothing.
class Kiosk {
  static const _channel = MethodChannel('in.manchestertech/kiosk');

  static Future<KioskStatus> status() async {
    try {
      final m = await _channel.invokeMapMethod<String, Object?>('status') ?? const {};
      return KioskStatus(owner: m['owner'] == true, locked: m['locked'] == true, maintenance: m['maintenance'] == true);
    } on MissingPluginException {
      return KioskStatus.none;
    } on PlatformException {
      return KioskStatus.none;
    }
  }

  static Future<bool> lock() => _call('lock');
  static Future<bool> unlock() => _call('unlock');
  static Future<bool> openWifiSettings() => _call('wifi');
  static Future<bool> openSettings() => _call('settings');
  static Future<bool> remove() => _call('release');

  static Future<bool> _call(String method) async {
    try {
      return await _channel.invokeMethod<bool>(method) ?? false;
    } on MissingPluginException {
      return false;
    } on PlatformException {
      return false;
    }
  }
}
