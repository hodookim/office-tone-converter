$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$secretDir = Join-Path $projectRoot "secrets"
$keystorePath = Join-Path $secretDir "office-tone-upload-key.jks"
$propertiesPath = Join-Path $secretDir "android-upload-key.properties"

if (Test-Path $keystorePath -PathType Leaf) {
  throw "Upload keystore already exists: $keystorePath"
}

if (Test-Path $propertiesPath -PathType Leaf) {
  throw "Signing properties already exist: $propertiesPath"
}

New-Item -ItemType Directory -Force -Path $secretDir | Out-Null

$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
if (!(Test-Path $keytool -PathType Leaf)) {
  throw "keytool not found: $keytool"
}

$alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%_-+=".ToCharArray()
$bytes = New-Object byte[] 40
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $rng.GetBytes($bytes)
} finally {
  $rng.Dispose()
}
$passwordChars = foreach ($byte in $bytes) { $alphabet[$byte % $alphabet.Length] }
$password = -join $passwordChars
$keyAlias = "office-tone-upload"

& $keytool `
  -genkeypair `
  -v `
  -keystore $keystorePath `
  -alias $keyAlias `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000 `
  -storepass $password `
  -keypass $password `
  -dname "CN=ITS AI, OU=Office Tone Converter, O=ITS AI, L=Seoul, ST=Seoul, C=KR"

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

@"
storeFile=../secrets/office-tone-upload-key.jks
storePassword=$password
keyAlias=$keyAlias
keyPassword=$password
"@ | Set-Content -Encoding ASCII -NoNewline -Path $propertiesPath

Write-Host "Created upload keystore: $keystorePath"
Write-Host "Created signing properties: $propertiesPath"
