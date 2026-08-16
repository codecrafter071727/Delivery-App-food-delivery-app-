# Local release APK for TOKAJO FOODS (Expo SDK 54)
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\build-local-apk.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

# Windows MAX_PATH workaround: build via short junction C:\tkj
$ShortRoot = "C:\tkj"
if (Test-Path $ShortRoot) {
  cmd /c "rmdir `"$ShortRoot`"" | Out-Null
}
cmd /c "mklink /J `"$ShortRoot`" `"$Root`"" | Out-Null
if (-not (Test-Path $ShortRoot)) {
  throw "Could not create short junction $ShortRoot -> $Root"
}
Set-Location $ShortRoot
Write-Host "==> Building via short path: $ShortRoot -> $Root" -ForegroundColor Cyan

$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:GRADLE_USER_HOME = "$env:USERPROFILE\.gradle-tokajo"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:Path"

if (-not (Test-Path "$env:JAVA_HOME\bin\java.exe")) {
  throw "Android Studio JBR not found at $env:JAVA_HOME"
}
if (-not (Test-Path "$env:ANDROID_HOME")) {
  throw "Android SDK not found at $env:ANDROID_HOME"
}
if (-not (Test-Path "$ShortRoot\.env")) {
  throw ".env missing - need EXPO_PUBLIC_API_URL and EXPO_PUBLIC_GOOGLE_MAPS_API_KEY"
}

New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME | Out-Null
& "$env:JAVA_HOME\bin\java.exe" -version

Get-Content "$ShortRoot\.env" | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { return }
  $i = $line.IndexOf("=")
  $k = $line.Substring(0, $i).Trim()
  $v = $line.Substring($i + 1).Trim().Trim('"').Trim("'")
  if ($k) { Set-Item -Path "Env:$k" -Value $v }
}
Write-Host "==> EXPO_PUBLIC_API_URL=$env:EXPO_PUBLIC_API_URL" -ForegroundColor Cyan
if ($env:EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) {
  Write-Host "==> Google Maps key: set" -ForegroundColor Cyan
} else {
  Write-Host "WARN: Google Maps key empty" -ForegroundColor Yellow
}

$env:CI = "1"
if (Test-Path "$ShortRoot\android\app\.cxx") {
  Remove-Item "$ShortRoot\android\app\.cxx" -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "==> Prebuild android (SDK 54)..." -ForegroundColor Cyan
npx expo prebuild --platform android --clean

$gradleProps = Join-Path $ShortRoot "android\gradle.properties"
if (-not (Test-Path $gradleProps)) { throw "android/gradle.properties missing after prebuild" }

$props = Get-Content $gradleProps -Raw
$props = $props -replace "reactNativeArchitectures=.*", "reactNativeArchitectures=arm64-v8a"
# New Arch codegen embeds full source paths into .o filenames and blows past Windows 260-char limit
$props = $props -replace "newArchEnabled=true", "newArchEnabled=false"
if ($props -notmatch "android.lint.checkReleaseBuilds") {
  $props += "`nandroid.lint.checkReleaseBuilds=false`n"
}
$props = $props -replace "org.gradle.jvmargs=.*", "org.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8"
Set-Content -Path $gradleProps -Value $props -Encoding utf8
Write-Host "==> arm64-v8a + newArchEnabled=false (Windows path fix)" -ForegroundColor Cyan

$foojay = Join-Path $ShortRoot "node_modules\@react-native\gradle-plugin\settings.gradle.kts"
if (Test-Path $foojay) {
  $foojayText = Get-Content $foojay -Raw
  $foojayText = $foojayText -replace 'version\("0\.5\.0"\)', 'version("1.0.0")'
  Set-Content -Path $foojay -Value $foojayText -Encoding utf8
}

$sdkEscaped = $env:ANDROID_HOME -replace '\\', '/'
Set-Content -Path (Join-Path $ShortRoot "android\local.properties") -Value "sdk.dir=$sdkEscaped" -Encoding utf8

Write-Host "==> Building release APK..." -ForegroundColor Cyan
Set-Location (Join-Path $ShortRoot "android")
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
if ($LASTEXITCODE -ne 0) {
  throw "Gradle build failed with exit $LASTEXITCODE"
}

$apk = Join-Path $ShortRoot "android\app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $apk)) { throw "APK not found at $apk" }

$dest = Join-Path $Root "TOKAJO-FOODS-release.apk"
Copy-Item $apk $dest -Force

Write-Host ""
Write-Host "APK READY:" -ForegroundColor Green
Write-Host "  $dest"
Write-Host ('Install: adb install -r "{0}"' -f $dest)
