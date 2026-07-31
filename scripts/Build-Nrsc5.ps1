param([switch]$Force)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')
Assert-WindowsX64

$root = Get-ProjectRoot
$runtimeDir = Join-Path $root 'runtime\nrsc5'
$required = Join-Path $runtimeDir 'libnrsc5.dll'
$hybridRequired = Join-Path $runtimeDir 'rtl_hybrid.exe'
$airspyHybridRequired = Join-Path $runtimeDir 'airspyhf_hybrid.exe'
$rdsRequired = Join-Path $runtimeDir 'redsea.exe'
if ((Test-Path -LiteralPath $required) -and (Test-Path -LiteralPath $hybridRequired) -and (Test-Path -LiteralPath $airspyHybridRequired) -and (Test-Path -LiteralPath $rdsRequired) -and -not $Force) {
    Write-Ok "nrsc5 ya está preparado: $runtimeDir"
    exit 0
}

& (Join-Path $PSScriptRoot 'Get-Runtimes.ps1') -IncludeMsys2:$true -Force:$false

$msysRoot = Join-Path $root '.cache\msys2\msys64'
$bash = Join-Path $msysRoot 'usr\bin\bash.exe'
$source = Join-Path $root 'third_party\nrsc5'
$build = Join-Path $root '.cache\nrsc5-build'
$airspySource = Join-Path $root 'third_party\airspyhf'
$airspyBuild = Join-Path $root '.cache\airspyhf-build'
$redseaSource = Join-Path $root 'third_party\redsea'
$liquidSource = Join-Path $root 'third_party\liquid-dsp'
$redseaBuild = Join-Path $root '.cache\redsea-build'
$liquidBuild = Join-Path $root '.cache\liquid-build'
if (-not (Test-Path -LiteralPath $bash)) { throw 'No se encontró el entorno MSYS2 autocontenido.' }
if (-not (Test-Path -LiteralPath (Join-Path $source 'CMakeLists.txt'))) { throw 'No se encontró la fuente fijada de nrsc5.' }

Write-Step 'Instalando el compilador y las bibliotecas SDR en MSYS2 local'
$oldMsystem = $env:MSYSTEM
$oldChere = $env:CHERE_INVOKING
$oldSource = $env:NRSC5_PORTABLE_SOURCE
$oldBuild = $env:NRSC5_PORTABLE_BUILD
$oldNativeSource = $env:NRSC5_PORTABLE_NATIVE_SOURCE
$oldAirspySource = $env:AIRSPYHF_PORTABLE_SOURCE
$oldAirspyBuild = $env:AIRSPYHF_PORTABLE_BUILD
$oldAirspyNativeSource = $env:AIRSPYHF_PORTABLE_NATIVE_SOURCE
$oldRedseaSource = $env:REDSEA_PORTABLE_SOURCE
$oldRedseaBuild = $env:REDSEA_PORTABLE_BUILD
$oldLiquidSource = $env:LIQUID_PORTABLE_SOURCE
$oldLiquidBuild = $env:LIQUID_PORTABLE_BUILD
try {
    $env:MSYSTEM = 'MINGW64'
    $env:CHERE_INVOKING = '1'
    $env:NRSC5_PORTABLE_SOURCE = $source
    $env:NRSC5_PORTABLE_BUILD = $build
    $env:NRSC5_PORTABLE_NATIVE_SOURCE = Join-Path $root 'native\rtl_hybrid'
    $env:AIRSPYHF_PORTABLE_SOURCE = $airspySource
    $env:AIRSPYHF_PORTABLE_BUILD = $airspyBuild
    $env:AIRSPYHF_PORTABLE_NATIVE_SOURCE = Join-Path $root 'native\airspyhf_hybrid'
    $env:REDSEA_PORTABLE_SOURCE = $redseaSource
    $env:REDSEA_PORTABLE_BUILD = $redseaBuild
    $env:LIQUID_PORTABLE_SOURCE = $liquidSource
    $env:LIQUID_PORTABLE_BUILD = $liquidBuild

    Invoke-Checked $bash @('-lc', 'pacman -Sy --noconfirm') $root
    $packages = 'autoconf automake git gzip make patch tar xz mingw-w64-x86_64-cmake mingw-w64-x86_64-gcc mingw-w64-x86_64-libtool mingw-w64-x86_64-rtl-sdr mingw-w64-x86_64-fftw mingw-w64-x86_64-libao mingw-w64-x86_64-meson mingw-w64-x86_64-ninja mingw-w64-x86_64-libsndfile mingw-w64-x86_64-nlohmann-json'
    Invoke-Checked $bash @('-lc', "pacman -S --needed --noconfirm $packages") $root

    Write-Step 'Compilando la revisión fijada de nrsc5'
    Reset-ProjectDirectory $build
    Reset-ProjectDirectory $airspyBuild
    Invoke-Checked $bash @('scripts/build-nrsc5-msys2.sh') $root
} finally {
    $env:MSYSTEM = $oldMsystem
    $env:CHERE_INVOKING = $oldChere
    $env:NRSC5_PORTABLE_SOURCE = $oldSource
    $env:NRSC5_PORTABLE_BUILD = $oldBuild
    $env:NRSC5_PORTABLE_NATIVE_SOURCE = $oldNativeSource
    $env:AIRSPYHF_PORTABLE_SOURCE = $oldAirspySource
    $env:AIRSPYHF_PORTABLE_BUILD = $oldAirspyBuild
    $env:AIRSPYHF_PORTABLE_NATIVE_SOURCE = $oldAirspyNativeSource
    $env:REDSEA_PORTABLE_SOURCE = $oldRedseaSource
    $env:REDSEA_PORTABLE_BUILD = $oldRedseaBuild
    $env:LIQUID_PORTABLE_SOURCE = $oldLiquidSource
    $env:LIQUID_PORTABLE_BUILD = $oldLiquidBuild
}

$mingwBin = Join-Path $msysRoot 'mingw64\bin'
if (-not (Test-Path -LiteralPath (Join-Path $mingwBin 'libnrsc5.dll'))) {
    throw 'La compilación terminó, pero no generó mingw64\bin\libnrsc5.dll.'
}

Reset-ProjectDirectory $runtimeDir
Get-ChildItem -LiteralPath $mingwBin -Filter '*.dll' | Copy-Item -Destination $runtimeDir -Force
foreach ($name in @('nrsc5.exe', 'airspyhf_info.exe', 'rtl_adsb.exe', 'rtl_biast.exe', 'rtl_eeprom.exe', 'rtl_fm.exe', 'rtl_power.exe', 'rtl_sdr.exe', 'rtl_tcp.exe', 'rtl_test.exe', 'redsea.exe')) {
    $candidate = Join-Path $mingwBin $name
    if (Test-Path -LiteralPath $candidate) { Copy-Item -LiteralPath $candidate -Destination $runtimeDir -Force }
}
$hybridBuild = Join-Path $build 'rtl_hybrid.exe'
if (-not (Test-Path -LiteralPath $hybridBuild)) {
    throw 'La compilacion no genero rtl_hybrid.exe.'
}
Copy-Item -LiteralPath $hybridBuild -Destination $runtimeDir -Force
$airspyHybridBuild = Join-Path $build 'airspyhf_hybrid.exe'
if (-not (Test-Path -LiteralPath $airspyHybridBuild)) { throw 'La compilacion no genero airspyhf_hybrid.exe.' }
Copy-Item -LiteralPath $airspyHybridBuild -Destination $runtimeDir -Force

$licenseDir = Join-Path $runtimeDir 'licenses'
New-Item -ItemType Directory -Path $licenseDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'LICENSE') -Destination (Join-Path $licenseDir 'nrsc5-GPL-3.0.txt') -Force
Copy-Item -LiteralPath (Join-Path $airspySource 'LICENSE.BSD') -Destination (Join-Path $licenseDir 'libairspyhf-BSD-3-Clause.txt') -Force
Copy-Item -LiteralPath (Join-Path $redseaSource 'LICENSE') -Destination (Join-Path $licenseDir 'redsea-MIT.txt') -Force
Copy-Item -LiteralPath (Join-Path $liquidSource 'LICENSE') -Destination (Join-Path $licenseDir 'liquid-dsp-MIT.txt') -Force
foreach ($package in @('rtl-sdr', 'libusb', 'fftw', 'faad2')) {
    $candidate = Join-Path $msysRoot "mingw64\share\licenses\$package"
    if (Test-Path -LiteralPath $candidate) { Copy-Item -LiteralPath $candidate -Destination $licenseDir -Recurse -Force }
}

$packageInfo = @(& $bash -lc 'pacman -Q') | Where-Object { $_ -match '(rtl-sdr|libusb|fftw|faad|gcc|cmake)' }
$info = [ordered]@{
    generatedAt = [DateTime]::UtcNow.ToString('o')
    sourceRepository = 'https://github.com/theori-io/nrsc5'
    sourceCommit = (Get-ProjectManifest).upstream.nrsc5
    airspyhfRepository = 'https://github.com/airspy/airspyhf'
    airspyhfCommit = (Get-ProjectManifest).upstream.airspyhf
    msys2Packages = @($packageInfo)
    files = @(Get-ChildItem -LiteralPath $runtimeDir -File | ForEach-Object {
        [ordered]@{ file = $_.Name; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
    })
}
Save-JsonUtf8 $info (Join-Path $runtimeDir 'manifest.json')
Write-Ok "nrsc5 compilado y preparado en $runtimeDir"
