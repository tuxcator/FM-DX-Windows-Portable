$ErrorActionPreference = 'Continue'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$app = Join-Path $root 'app'
$node = Join-Path $root 'runtime\node\node.exe'
$python = Join-Path $root 'runtime\python\python.exe'
$plugin = Join-Path $app 'plugins\NRSC5_HDRadio'
$failures = 0

function Check([string]$Name, [scriptblock]$Action) {
    try {
        $result = & $Action
        if ($LASTEXITCODE -ne 0) { throw "Código de salida $LASTEXITCODE" }
        Write-Host "[OK] $Name" -ForegroundColor Green
        if ($null -ne $result -and "$result") { Write-Host "     $result" }
    } catch {
        $script:failures++
        Write-Host "[ERROR] $Name" -ForegroundColor Red
        Write-Host "        $_" -ForegroundColor DarkRed
    }
}
$hardware = & (Join-Path $PSScriptRoot 'Detect-Hardware.ps1') -Root $root -Quiet -NoWrite
Write-Host "Sintonizador seleccionado: $(switch ($hardware.Selected) { 'airspyhf' { 'Airspy HF+ / NRSC-5' }; 'rtl' { 'RTL-SDR / NRSC-5' }; default { 'TEF668x / XDR' } })"

Write-Host 'Diagnóstico de FM-DX Windows Portable' -ForegroundColor Cyan
Check 'Node.js portátil' { if (-not (Test-Path $node)) { throw 'node.exe ausente' }; & $node --version }
Check 'Python portátil' { if (-not (Test-Path $python)) { throw 'python.exe ausente' }; & $python --version }
Check 'Configuración JSON' {
    $config = Get-Content -Raw (Join-Path $app 'config.json') | ConvertFrom-Json
    "Puerto $($config.webserver.webserverPort), audio $($config.audio.audioDevice)"
}
Check 'Dependencias Node.js' { Push-Location $app; try { & $node -e "require('./package.json'); require('express'); require('serialport'); require('ws'); console.log('módulos cargados')" } finally { Pop-Location } }
Check 'Biblioteca NRSC-5' {
    $code = "import os,sys; p=r'$plugin'; os.add_dll_directory(p); sys.path.insert(0,p); import nrsc5; r=nrsc5.NRSC5(lambda t,e:None); print(nrsc5.NRSC5.get_version())"
    & $python -c $code
}
Write-Host 'Comprobando entradas de audio DirectShow...'
$audioOutput = & $node (Join-Path $app 'list-audio-devices.js') 2>&1
try { $audioDevices = @($audioOutput | ConvertFrom-Json) } catch { $audioDevices = @() }
$config = Get-Content -Raw (Join-Path $app 'config.json') | ConvertFrom-Json
$configuredAudio = [string]$config.audio.audioDevice
if ($LASTEXITCODE -eq 0 -and $audioDevices.Count -gt 0) {
    Write-Host '[OK] Entradas de audio DirectShow detectadas:' -ForegroundColor Green
    $audioDevices | ForEach-Object { Write-Host "     $($_.name)" }
    if ($config.device -eq 'tef' -and [string]::IsNullOrWhiteSpace($configuredAudio)) {
        Write-Host '[WARN] TEF esta activo, pero no tiene entrada de audio seleccionada. Ejecute Configurar.cmd.' -ForegroundColor Yellow
    } elseif ($config.device -eq 'tef' -and $configuredAudio -notin @($audioDevices.name)) {
        Write-Host "[WARN] La entrada configurada no esta disponible: $configuredAudio" -ForegroundColor Yellow
        Write-Host '       Conecte la tarjeta externa y ejecute Configurar.cmd.' -ForegroundColor DarkYellow
    }
} else {
    Write-Host '[WARN] Windows/FFmpeg no detecto ninguna entrada DirectShow.' -ForegroundColor Yellow
    Write-Host '       Conecte la tarjeta de sonido del TEF y ejecute Configurar.cmd.' -ForegroundColor DarkYellow
}
Write-Host ''
Write-Host 'Comprobando Airspy HF+ mediante libairspyhf...' -ForegroundColor Yellow
if ($hardware.AirspyPresent -and $hardware.AirspyAccessible) {
    Write-Host '[OK] Airspy HF+ detectado y disponible por USB.' -ForegroundColor Green
    $hardware.AirspyOutput -split "`r?`n" | Select-Object -First 20
} elseif ($hardware.AirspyPresent) {
    Write-Host '[WARN] Airspy HF+ detectado, pero otro programa puede estar usandolo.' -ForegroundColor Yellow
    $hardware.AirspyOutput -split "`r?`n" | Select-Object -First 20
} else {
    Write-Host '[INFO] Airspy HF+ no esta conectado actualmente.' -ForegroundColor DarkGray
}
$rtlEeprom = Join-Path $plugin 'rtl_eeprom.exe'
if (Test-Path -LiteralPath $rtlEeprom) {
    Write-Host ''
    Write-Host 'Comprobando RTL-SDR. Un error puede indicar que falta WinUSB o que otro programa usa el dispositivo.' -ForegroundColor Yellow
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $rtlEeprom
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $rtlProcess = [System.Diagnostics.Process]::Start($startInfo)
    $rtlStdout = $rtlProcess.StandardOutput.ReadToEnd()
    $rtlStderr = $rtlProcess.StandardError.ReadToEnd()
    $rtlProcess.WaitForExit()
    $rtlExitCode = $rtlProcess.ExitCode
    $rtlText = ($rtlStdout + [Environment]::NewLine + $rtlStderr).Trim()
    $rtlText -split "`r?`n" | Select-Object -First 30
    if ($rtlText -match 'Current configuration:' -and $rtlText -notmatch 'Failed to open rtlsdr device|usb_open error') {
        Write-Host '[OK] RTL-SDR abierto correctamente mediante WinUSB.' -ForegroundColor Green
    } elseif ($rtlText -match 'Failed to open rtlsdr device|usb_open error') {
        Write-Host '[WARN] RTL-SDR detectado, pero esta ocupado o no se pudo abrir. Cierre SDR# y otros programas SDR antes de iniciar FM-DX.' -ForegroundColor Yellow
    } elseif ($rtlExitCode -ne 0) {
        Write-Host '[WARN] La herramienta RTL-SDR termino con un codigo no cero; revise la salida anterior.' -ForegroundColor Yellow
    }
} else {
    Write-Host '[WARN] rtl_eeprom.exe no está incluido.' -ForegroundColor Yellow
}

Write-Host ''
if ($failures -eq 0) {
    Write-Host 'Diagnóstico de software completado correctamente.' -ForegroundColor Green
    exit 0
}
Write-Host "Diagnóstico terminó con $failures error(es)." -ForegroundColor Red
exit 1
