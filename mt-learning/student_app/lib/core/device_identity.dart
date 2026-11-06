import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';

class DeviceInfo {
  const DeviceInfo({this.appVersion, this.androidVersion, this.model});
  final String? appVersion;
  final String? androidVersion;
  final String? model;
}

/// Reads app and OS versions for heartbeats.
///
/// Android 10+ does not let ordinary apps read the hardware serial number, so the
/// tablet's serial is entered once by the device administrator during setup. When the
/// tablets are enrolled in an MDM (Phase 4), the MDM will supply it as a managed configuration.
class DeviceIdentity {
  DeviceInfo? _cached;

  Future<DeviceInfo> describe() async {
    if (_cached != null) return _cached!;
    String? appVersion;
    String? androidVersion;
    String? model;
    try {
      final pkg = await PackageInfo.fromPlatform();
      appVersion = '${pkg.version}+${pkg.buildNumber}';
    } catch (_) {}
    try {
      if (defaultTargetPlatform == TargetPlatform.android) {
        final a = await DeviceInfoPlugin().androidInfo;
        androidVersion = a.version.release;
        model = '${a.manufacturer} ${a.model}';
      }
    } catch (_) {}
    return _cached = DeviceInfo(appVersion: appVersion, androidVersion: androidVersion, model: model);
  }
}
