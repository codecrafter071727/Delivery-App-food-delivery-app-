# Reliable local APK build for Windows (Expo SDK 54)
# Why C:\p? Long Desktop paths break CMake (260-char limit).
# First time: project must already exist at C:\p (copy once).
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\build-from-short-path.ps1

$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $PSScriptRoot

Write-Host "Syncing project to C:\p (avoids Windows path limit)..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path C:\p | Out-Null
robocopy $src C:\p /E /XD .git .expo "android\app\build" "android\app\.cxx" "android\build" "node_modules\.cache" "android\.gradle" | Out-Null

Set-Location C:\p

$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
# Prefer Android Studio JBR (JDK 21); fall back to common JDK installs.
if (Test-Path "C:\Program Files\Android\Android Studio\jbr") {
  $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
} elseif (Test-Path "C:\Program Files\Java\jdk-17") {
  $env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
} else {
  throw "No suitable JDK found (need Android Studio JBR or JDK 17+)."
}
$env:GRADLE_USER_HOME = "C:\g"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
$env:CI = "1"
New-Item -ItemType Directory -Force -Path $env:GRADLE_USER_HOME | Out-Null

# Stop leftover Gradle daemons that lock the cache
Get-Process java -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*Android Studio*" -or $_.Path -like "*jbr*" } | Out-Null

if (Test-Path C:\p\.env) {
  Get-Content C:\p\.env | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { return }
    $i = $line.IndexOf("=")
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim().Trim('"').Trim("'")
    if ($k) { Set-Item -Path "Env:$k" -Value $v }
  }
}

Write-Host "API=$env:EXPO_PUBLIC_API_URL maps=$(if ($env:EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) {'set'} else {'MISSING'})" -ForegroundColor Cyan

if (-not (Test-Path C:\p\android\gradle.properties)) {
  npx expo prebuild --platform android --clean
}

$gp = "C:\p\android\gradle.properties"
$props = Get-Content $gp -Raw
$props = $props -replace "reactNativeArchitectures=.*", "reactNativeArchitectures=arm64-v8a"
$props = $props -replace "newArchEnabled=false", "newArchEnabled=true"
if ($props -notmatch "android.lint.checkReleaseBuilds") { $props += "`nandroid.lint.checkReleaseBuilds=false`n" }
$props = $props -replace "org.gradle.jvmargs=.*", "org.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8"
Set-Content $gp $props -Encoding utf8

$sdk = ($env:ANDROID_HOME -replace '\\', '/')
Set-Content C:\p\android\local.properties "sdk.dir=$sdk" -Encoding utf8

Set-Location C:\p\android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
if ($LASTEXITCODE -ne 0) { throw "Gradle failed $LASTEXITCODE" }

$apk = "C:\p\android\app\build\outputs\apk\release\app-release.apk"
$dest = "$src\TOKAJO-FOODS-release.apk"
Copy-Item $apk $dest -Force
Copy-Item $apk "C:\p\TOKAJO-FOODS-release.apk" -Force

Write-Host ""
Write-Host "APK READY:" -ForegroundColor Green
Write-Host "  $dest"
Write-Host ('Install: adb install -r "{0}"' -f $dest)
