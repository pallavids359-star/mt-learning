$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Test-Path 'android')) {
  flutter create --platforms=android --org in.manchestertech --project-name mt_student --no-pub .
  if ($LASTEXITCODE -ne 0) { throw 'flutter create failed' }
  Remove-Item 'test\widget_test.dart' -ErrorAction SilentlyContinue
}

$manifest = 'android\app\src\main\AndroidManifest.xml'
$xml = Get-Content $manifest -Raw
if ($xml -notmatch 'android.permission.INTERNET') {
  $xml = $xml -replace '<application', "<uses-permission android:name=`"android.permission.INTERNET`"/>`n    <application"
}
$xml = $xml -replace 'android:label="[^"]*"', 'android:label="MT Learning"'
if ($xml -notmatch 'android:allowBackup') {
  $xml = $xml -replace '<application', '<application android:allowBackup="false" android:fullBackupContent="false"'
}
Set-Content $manifest $xml -NoNewline

$debugManifest = 'android\app\src\debug\AndroidManifest.xml'
if (Test-Path $debugManifest) {
  $dbg = Get-Content $debugManifest -Raw
  if ($dbg -notmatch 'usesCleartextTraffic') {
    $dbg = $dbg -replace '</manifest>', "    <application android:usesCleartextTraffic=`"true`"/>`n</manifest>"
    Set-Content $debugManifest $dbg -NoNewline
  }
}

$gradle = @('android\app\build.gradle.kts', 'android\app\build.gradle') | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($gradle) {
  $g = Get-Content $gradle -Raw
  $g = $g -replace 'minSdk( =|) flutter\.minSdkVersion', 'minSdk$1 23'
  Set-Content $gradle $g -NoNewline
}

Write-Host "Android project ready: $manifest" -ForegroundColor Green
