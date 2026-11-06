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

# flutter_secure_storage needs minSdk 23.
GRADLE=$(ls android/app/build.gradle.kts android/app/build.gradle 2>/dev/null | head -1)
if [ -n "$GRADLE" ]; then
  sed -i.bak -E 's/minSdk( =|) flutter\.minSdkVersion/minSdk\1 23/' "$GRADLE" && rm -f "$GRADLE.bak"
fi

echo "Android project ready: $MANIFEST"
