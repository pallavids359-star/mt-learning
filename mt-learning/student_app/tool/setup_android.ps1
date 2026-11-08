# Windows version of setup_android.sh.
# Creates the Android project folder (once) and applies the app's required settings.
# Run from the student_app folder:
#   powershell -ExecutionPolicy Bypass -File tool\setup_android.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Test-Path 'android')) {
  flutter create --platforms=android --org in.manchestertech --project-name mt_student --no-pub .
  if ($LASTEXITCODE -ne 0) { throw 'flutter create failed' }
  # flutter create adds a sample test that does not apply to this app.
  Remove-Item 'test\widget_test.dart' -ErrorAction SilentlyContinue
}

$manifest = 'android\app\src\main\AndroidManifest.xml'
$xml = Get-Content $manifest -Raw

# Internet access (release builds do not get it by default).
if ($xml -notmatch 'android.permission.INTERNET') {
  $xml = $xml -replace '<application', "<uses-permission android:name=`"android.permission.INTERNET`"/>`n    <application"
}
# App name, and no cloud backup of app data (sessions and student data stay on the tablet).
$xml = $xml -replace 'android:label="[^"]*"', 'android:label="MT Learning"'
if ($xml -notmatch 'android:allowBackup') {
  $xml = $xml -replace '<application', '<application android:allowBackup="false" android:fullBackupContent="false"'
}
# Kiosk mode: the app can be the home screen, run in lock task mode and be the device owner.
if ($xml -notmatch 'lockTaskMode') {
  $xml = $xml -replace 'android:name="\.MainActivity"', "android:name=`".MainActivity`"`n            android:lockTaskMode=`"if_whitelisted`""
}
if ($xml -notmatch 'category.HOME') {
  $xml = $xml -replace '(<category android:name="android.intent.category.LAUNCHER"\s*/>\s*</intent-filter>)', "`$1`n            <intent-filter>`n                <action android:name=`"android.intent.action.MAIN`"/>`n                <category android:name=`"android.intent.category.HOME`"/>`n                <category android:name=`"android.intent.category.DEFAULT`"/>`n            </intent-filter>"
}
if ($xml -notmatch 'AdminReceiver') {
  $receiver = @'
        <receiver
            android:name=".AdminReceiver"
            android:exported="true"
            android:permission="android.permission.BIND_DEVICE_ADMIN">
            <meta-data android:name="android.app.device_admin" android:resource="@xml/device_admin"/>
            <intent-filter>
                <action android:name="android.app.action.DEVICE_ADMIN_ENABLED"/>
            </intent-filter>
        </receiver>
    </application>
'@
  $xml = $xml -replace '</application>', $receiver.Replace('$', '$$')
}
Set-Content $manifest $xml -NoNewline

# Kiosk code: the app's Android entry point and its device-admin receiver.
$kotlin = 'android\app\src\main\kotlin\in\manchestertech\mt_student'
New-Item -ItemType Directory -Force $kotlin | Out-Null
Copy-Item 'tool\android\MainActivity.kt' $kotlin -Force
Copy-Item 'tool\android\AdminReceiver.kt' $kotlin -Force
New-Item -ItemType Directory -Force 'android\app\src\main\res\xml' | Out-Null
Copy-Item 'tool\android\device_admin.xml' 'android\app\src\main\res\xml\' -Force

# Test builds only: allow plain http:// so the app can reach the server on this laptop.
# Real (release) builds must use an https:// server address.
$debugManifest = 'android\app\src\debug\AndroidManifest.xml'
if (Test-Path $debugManifest) {
  $dbg = Get-Content $debugManifest -Raw
  if ($dbg -notmatch 'usesCleartextTraffic') {
    $dbg = $dbg -replace '</manifest>', "    <application android:usesCleartextTraffic=`"true`"/>`n</manifest>"
    Set-Content $debugManifest $dbg -NoNewline
  }
}

# flutter_secure_storage needs Android 6 (minSdk 23) or newer.
$gradle = @('android\app\build.gradle.kts', 'android\app\build.gradle') | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($gradle) {
  $g = Get-Content $gradle -Raw
  $g = $g -replace 'minSdk( =|) flutter\.minSdkVersion', 'minSdk$1 23'
  Set-Content $gradle $g -NoNewline
}

Write-Host "Android project ready: $manifest" -ForegroundColor Green
