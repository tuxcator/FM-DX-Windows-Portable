$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$app = Join-Path $root 'app'
$node = Join-Path $root 'runtime\node\node.exe'
$mainPath = Join-Path $app 'config.json'
$hdPath = Join-Path $app 'plugins_configs\NRSC5_HDRadio.json'

function Save-Json([object]$Value, [string]$Path) {
    $json = $Value | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}

if (-not (Test-Path -LiteralPath $node)) { throw "No se encontró Node.js portátil: $node" }
$main = Get-Content -Raw -LiteralPath $mainPath | ConvertFrom-Json
$hd = Get-Content -Raw -LiteralPath $hdPath | ConvertFrom-Json
if (-not $main.PSObject.Properties['portableHardware']) {
    $main | Add-Member -NotePropertyName portableHardware -NotePropertyValue ([pscustomobject]@{ mode = 'auto'; detected = 'unknown'; rtlAccessible = $false })
}


Write-Host 'Configurador de FM-DX Windows Portable' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Modo de sintonizador:'
Write-Host '  [0] Automatico: Airspy HF+ primero, RTL-SDR como respaldo'
Write-Host '  [1] Airspy HF+ / NRSC-5'
Write-Host '  [2] RTL-SDR / NRSC-5'
Write-Host '  [3] TEF668x / XDR con entrada de audio'
$modeSelection = Read-Host "Seleccione modo [$($main.portableHardware.mode)]"
switch ($modeSelection) {
    '0' { $main.portableHardware.mode = 'auto' }
    '1' { $main.portableHardware.mode = 'airspyhf' }
    '2' { $main.portableHardware.mode = 'rtl' }
    '3' { $main.portableHardware.mode = 'tef' }
}


try {
    $rawDevices = & $node (Join-Path $app 'list-audio-devices.js')
    $devices = @($rawDevices | ConvertFrom-Json)
} catch {
    $devices = @()
    Write-Host "No se pudieron enumerar las entradas de audio: $_" -ForegroundColor Yellow
}

if ($devices.Count -gt 0) {
    Write-Host 'Entradas de audio detectadas:' -ForegroundColor White
    for ($i = 0; $i -lt $devices.Count; $i++) { Write-Host "  [$i] $($devices[$i].name)" }
    $selection = Read-Host "Seleccione una entrada [$($main.audio.audioDevice)]"
    if ($selection -match '^\d+$' -and [int]$selection -lt $devices.Count) {
        $main.audio.audioDevice = $devices[[int]$selection].name
    }
} else {
    $audioName = Read-Host "Nombre DirectShow de la entrada de audio [$($main.audio.audioDevice)]"
    if ($audioName) { $main.audio.audioDevice = $audioName }
}

$port = Read-Host "Puerto web [$($main.webserver.webserverPort)]"
if ($port -match '^\d+$' -and [int]$port -ge 1024 -and [int]$port -le 65535) { $main.webserver.webserverPort = [int]$port }

if (-not $hd.PSObject.Properties['airspySerial']) { $hd | Add-Member -NotePropertyName airspySerial -NotePropertyValue 'auto' }
if (-not $hd.PSObject.Properties['airspyAttenuation']) { $hd | Add-Member -NotePropertyName airspyAttenuation -NotePropertyValue 0 }
$airspySerial = Read-Host "Serie Airspy HF+ o auto [$($hd.airspySerial)]"
if ($airspySerial) { $hd.airspySerial = $airspySerial }
$airspyAttenuation = Read-Host "Atenuacion Airspy HF+ en dB [$($hd.airspyAttenuation)]"
if ($airspyAttenuation -match '^\d+(\.\d+)?$') { $hd.airspyAttenuation = [double]$airspyAttenuation }
$device = Read-Host "Índice del RTL-SDR para HD Radio [$($hd.deviceIndex)]"
if ($device -match '^\d+$') { $hd.deviceIndex = [int]$device }

$gain = Read-Host "Ganancia RTL-SDR en dB [$($hd.gain)]"
if ($gain -match '^\d+(\.\d+)?$') { $hd.gain = [double]$gain; $hd.autoGain = $false }

$ppm = Read-Host "Corrección PPM [$($hd.ppm)]"
if ($ppm -match '^-?\d+$') { $hd.ppm = [int]$ppm }

$autoStart = Read-Host '¿Iniciar HD Radio automáticamente? (s/N)'
$hd.autoStart = $autoStart -match '^[sSyY]'

Save-Json $main $mainPath
Save-Json $hd $hdPath
$hardware = & (Join-Path $PSScriptRoot 'Detect-Hardware.ps1') -Root $root -Quiet
$main = Get-Content -Raw -LiteralPath $mainPath | ConvertFrom-Json
$hd = Get-Content -Raw -LiteralPath $hdPath | ConvertFrom-Json

Write-Host ''
Write-Host 'Configuración guardada.' -ForegroundColor Green
Write-Host "Sintonizador: $(switch ($hardware.Selected) { 'airspyhf' { 'Airspy HF+ / NRSC-5' }; 'rtl' { 'RTL-SDR / NRSC-5' }; default { 'TEF668x / XDR' } })"
Write-Host "Audio: $($main.audio.audioDevice)"
Write-Host "Web: http://localhost:$($main.webserver.webserverPort)"
Write-Host "RTL-SDR HD: índice $($hd.deviceIndex), ganancia $($hd.gain) dB, PPM $($hd.ppm)"
Write-Host 'Use la administración web para establecer contraseñas antes del acceso remoto.' -ForegroundColor Yellow
