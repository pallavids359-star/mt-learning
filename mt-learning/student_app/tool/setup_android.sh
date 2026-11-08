#!/usr/bin/env bash
# Generates the Android platform folder (once) and applies the app's required settings.
# Run from student_app/:  ./tool/setup_android.sh
# Commit the resulting android/ folder afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d android ]; then
  flutter create --platforms=android --org in.manchestertech --project-name mt_student --no-pub .
  # flutter create adds a sample test that does not apply to this app.
  rm -f test/widget_test.dart
fi

MANIFEST=android/app/src/main/AndroidManifest.xml

# Internet access (release builds do not get it by default).
grep -q 'android.permission.INTERNET' "$MANIFEST" || \
  sed -i.bak 's#<application#<uses-permission android:name="android.permission.INTERNET"/>\n    <application#' "$MANIFEST"

# App name, no cloud backup of app data (sessions and cached student data must stay on the tablet).
sed -i.bak \
  -e 's#android:label="[^"]*"#android:label="MT Learning"#' \
  -e 's#<application#<application android:allowBackup="false" android:fullBackupContent="false"#' \
  "$MANIFEST"
# Avoid duplicating the attributes if the script runs twice.
perl -0pi -e 's/(android:allowBackup="false" android:fullBackupContent="false"\s+)+/android:allowBackup="false" android:fullBackupContent="false" /' "$MANIFEST"
rm -f "$MANIFEST.bak"

# Kiosk mode: home screen, lock task mode and the device-admin receiver (see docs/TABLET_SETUP.md).
grep -q lockTaskMode "$MANIFEST" || \
  perl -0pi -e 's#android:name="\.MainActivity"#android:name=".MainActivity"\n            android:lockTaskMode="if_whitelisted"#' "$MANIFEST"
grep -q category.HOME "$MANIFEST" || \
  perl -0pi -e 's#(<category android:name="android.intent.category.LAUNCHER"\s*/>\s*</intent-filter>)#$1\n            <intent-filter>\n                <action android:name="android.intent.action.MAIN"/>\n                <category android:name="android.intent.category.HOME"/>\n                <category android:name="android.intent.category.DEFAULT"/>\n            </intent-filter>#' "$MANIFEST"
grep -q AdminReceiver "$MANIFEST" || \
  perl -0pi -e 's#</application>#    <receiver android:name=".AdminReceiver" android:exported="true" android:permission="android.permission.BIND_DEVICE_ADMIN">\n            <meta-data android:name="android.app.device_admin" android:resource="\@xml/device_admin"/>\n            <intent-filter><action android:name="android.app.action.DEVICE_ADMIN_ENABLED"/></intent-filter>\n        </receiver>\n    </application>#' "$MANIFEST"
KOTLIN=android/app/src/main/kotlin/in/manchestertech/mt_student
mkdir -p "$KOTLIN" android/app/src/main/res/xml
cp tool/android/MainActivity.kt tool/android/AdminReceiver.kt "$KOTLIN/"
cp tool/android/device_admin.xml android/app/src/main/res/xml/

# Test builds only: allow plain http:// so the app can reach a server on the developer's machine.
DEBUG_MANIFEST=android/app/src/debug/AndroidManifest.xml
if [ -f "$DEBUG_MANIFEST" ] && ! grep -q usesCleartextTraffic "$DEBUG_MANIFEST"; then
  sed -i.bak 's#</manifest>#    <application android:usesCleartextTraffic="true"/>\n</manifest>#' "$DEBUG_MANIFEST" && rm -f "$DEBUG_MANIFEST.bak"
fi

# flutter_secure_storage needs minSdk 23.
GRADLE=$(ls android/app/build.gradle.kts android/app/build.gradle 2>/dev/null | head -1 || true)
if [ -n "$GRADLE" ]; then
  sed -i.bak -E 's/minSdk( =|) flutter\.minSdkVersion/minSdk\1 23/' "$GRADLE" && rm -f "$GRADLE.bak"
fi

echo "Android project ready: $MANIFEST"
