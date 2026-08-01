param([string]$DistributionPath = '')

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$failures = New-Object System.Collections.Generic.List[string]

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { $script:failures.Add($Message) }
}

function Test-JsonFile([string]$Path) {
    try { Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json | Out-Null }
    catch { $script:failures.Add("JSON invÃƒÆ’Ã‚Â¡lido: $Path - $_") }
}

Write-Host 'Ejecutando pruebas del proyecto...' -ForegroundColor Cyan

foreach ($relative in @(
    'project.json', 'README.md', 'config\config.json', 'config\NRSC5_HDRadio.json',
    'scripts\Build-Portable.ps1', 'scripts\Get-Runtimes.ps1', 'scripts\Get-Nrsc5.ps1', 'scripts\Build-Nrsc5.ps1', 'scripts\Update-GitHub.ps1', 'Actualizar-GitHub.cmd',
    'packaging\scripts\Detect-Hardware.ps1', 'packaging\scripts\Configure-RemotePasswords.ps1',
    'packaging\scripts\Enable-Network.ps1',
    'packaging\scripts\Publish-Internet.ps1', 'packaging\Configurar-Contrasenas.cmd',
    'packaging\Habilitar-Red-Local.cmd',
    'packaging\Publicar-Internet.cmd', 'overlays\fm-dx-webserver\server\rtl_virtual_output.js',
    'overlays\fm-dx-webserver\server\stream\parser.js', 'overlays\fm-dx-webserver\server\stream\index.js',
    'overlays\fm-dx-webserver\plugins\NRSC5_HDRadio\hybrid_bridge.py',
    'overlays\fm-dx-webserver\plugins\NRSC5_HDRadio\analog_rds.js',
    'overlays\fm-dx-webserver\plugins\NRSC5_HDRadio\NRSC5_HDRadio_frontend_server.js',
    'overlays\fm-dx-webserver\plugins\NRSC5_HDRadio\NRSC5_HDRadio_frontend.js',
    'native\rtl_hybrid\rtl_hybrid.c', 'native\airspyhf_hybrid\airspyhf_hybrid.c',
    'patches\fm-dx-webserver-rtl.patch', 'patches\nrsc5-plugin-hybrid.patch', 'patches\nrsc5-python-cf32.patch',
    'patches\fm-dx-webserver-stability.patch',
    'patches\nrsc5-plugin-stability.patch',
    'patches\nrsc5-audio-stability.patch',
    'patches\nrsc5-subchannels.patch',
    'third_party\fm-dx-webserver\package-lock.json',
    'third_party\NRSC5_HDRadio\NRSC5_HDRadio\hd_bridge.py',
    'third_party\nrsc5\CMakeLists.txt', 'third_party\nrsc5-gui\nrsc5_gui.py'
)) {
    Assert-True (Test-Path -LiteralPath (Join-Path $root $relative)) "Falta $relative"
}

Test-JsonFile (Join-Path $root 'project.json')
Test-JsonFile (Join-Path $root 'config\config.json')
Test-JsonFile (Join-Path $root 'config\NRSC5_HDRadio.json')

$airspyNativeText = Get-Content -Raw -LiteralPath (Join-Path $root 'native\airspyhf_hybrid\airspyhf_hybrid.c')
Assert-True ($airspyNativeText -match 'ANALOG_HALF_BANDWIDTH_HZ 95000\.0') 'El canal FM analogico no usa el filtro fino de 190 kHz.'
Assert-True ($airspyNativeText -match 'target_blend = pilot_blend \* \(0\.30 \+ 0\.70 \* snr_blend\)') 'El estereo Airspy no reduce ruido metalico cuando baja el SNR.'

$manifest = Get-Content -Raw -LiteralPath (Join-Path $root 'project.json') | ConvertFrom-Json
$repos = @{
    'airspyhf' = 'third_party\airspyhf'
    'fm-dx-webserver' = 'third_party\fm-dx-webserver'
    'NRSC5_HDRadio' = 'third_party\NRSC5_HDRadio'
    'nrsc5' = 'third_party\nrsc5'
    'nrsc5-gui' = 'third_party\nrsc5-gui'
    'redsea' = 'third_party\redsea'
    'liquid-dsp' = 'third_party\liquid-dsp'
}
foreach ($name in $repos.Keys) {
    $repoPath = Join-Path $root $repos[$name]
    if (Test-Path -LiteralPath (Join-Path $repoPath '.git')) {
        $actual = (& git -C $repoPath rev-parse HEAD).Trim()
        $expected = "$($manifest.upstream.$name)"
        Assert-True ($actual -eq $expected) "RevisiÃƒÆ’Ã‚Â³n inesperada en $name`: $actual; esperada $expected"
    }
}

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCommand) {
    & $pythonCommand.Source -c "import ast,pathlib,sys; [ast.parse(pathlib.Path(p).read_text(encoding='utf-8')) for p in sys.argv[1:]]" (Join-Path $root 'third_party\NRSC5_HDRadio\NRSC5_HDRadio\hd_bridge.py') (Join-Path $root 'third_party\NRSC5_HDRadio\NRSC5_HDRadio\nrsc5.py')
    Assert-True ($LASTEXITCODE -eq 0) 'Los archivos Python del plugin no compilan.'
}

if ($DistributionPath) {
    $dist = [System.IO.Path]::GetFullPath($DistributionPath)
    foreach ($relative in @(
        'Iniciar.cmd', 'Configurar.cmd', 'Diagnostico.cmd',
        'Configurar-Contrasenas.cmd', 'Habilitar-Red-Local.cmd', 'Publicar-Internet.cmd',
        'scripts\Configure-RemotePasswords.ps1', 'scripts\Enable-Network.ps1', 'scripts\Publish-Internet.ps1',
        'runtime\node\node.exe', 'runtime\python\python.exe',
        'app\index.js', 'app\node_modules\express',
        'app\server\rtl_virtual_output.js', 'app\server\stream\parser.js', 'app\server\stream\index.js', 'scripts\Detect-Hardware.ps1',
        'app\plugins\NRSC5_HDRadio\libnrsc5.dll',
        'app\plugins\NRSC5_HDRadio\NRSC5_HDRadio_frontend_server.js',
        'app\plugins\NRSC5_HDRadio\rtl_hybrid.exe',
        'app\plugins\NRSC5_HDRadio\airspyhf_hybrid.exe',
        'app\plugins\NRSC5_HDRadio\airspyhf_info.exe',
        'app\plugins\NRSC5_HDRadio\redsea.exe',
        'app\plugins\NRSC5_HDRadio\analog_rds.js',
        'app\plugins\NRSC5_HDRadio\libairspyhf.dll',
        'app\plugins\NRSC5_HDRadio\hybrid_bridge.py',
        'app\plugins_configs\NRSC5_HDRadio.json'
    )) {
        Assert-True (Test-Path -LiteralPath (Join-Path $dist $relative)) "Paquete incompleto: $relative"
    }

    Test-JsonFile (Join-Path $dist 'app\config.json')
    Test-JsonFile (Join-Path $dist 'app\plugins_configs\NRSC5_HDRadio.json')
    $distConfig = Get-Content -Raw -LiteralPath (Join-Path $dist 'app\config.json') | ConvertFrom-Json
    Assert-True ($distConfig.device -in @('sdr', 'tef')) 'El paquete no identifica un receptor compatible.'
    Assert-True (($distConfig.device -eq 'sdr' -and $distConfig.portableRtlMode -eq $true) -or ($distConfig.device -eq 'tef' -and $distConfig.portableRtlMode -eq $false)) 'El modo de audio no coincide con el receptor seleccionado.'
    $serverIndex = Get-Content -Raw -LiteralPath (Join-Path $dist 'app\server\index.js')
    $bridgeText = Get-Content -Raw -LiteralPath (Join-Path $dist 'app\plugins\NRSC5_HDRadio\hd_bridge.py')
    $streamText = Get-Content -Raw -LiteralPath (Join-Path $dist 'app\server\stream\index.js')
    $endpointsText = Get-Content -Raw -LiteralPath (Join-Path $dist 'app\server\endpoints.js')
    $pluginServerText = Get-Content -Raw -LiteralPath (Join-Path $dist 'app\plugins\NRSC5_HDRadio\NRSC5_HDRadio_frontend_server.js')
    $dataHandlerText = Get-Content -Raw -LiteralPath (Join-Path $dist 'app\server\datahandler.js')
    Assert-True ($dataHandlerText -match 'resetRds: rdsReset') 'El nucleo no expone el reinicio de RDS al resintonizar.'
    Assert-True ($pluginServerText -match 'rtlCapturePath') 'El plugin no conserva el respaldo RTL compartido.'
    Assert-True ($pluginServerText -match 'airspyCapturePath') 'El plugin no usa la captura Airspy HF+ compartida.'
    Assert-True ($pluginServerText -match 'audio_program') 'El servidor no descubre los subcanales HD recibidos.'
    Assert-True ($pluginServerText -match 'Selecting HD.*without retuning') 'Cambiar HD1/HD2/HD3 todavia resintoniza el receptor.'
    Assert-True ($pluginServerText -match 'HD re-enabled on existing receiver capture') 'HD Radio ON todavia reinicia y desconecta el receptor compartido.'
    Assert-True ($pluginServerText -match 'iqFormat.+cf32') 'El plugin no selecciona CF32 para Airspy HF+. '
    Assert-True ($pluginServerText -match 'wss: pluginsApi\.getWss\(\)') 'El RDS analogico no se transmite al WebSocket principal.'
    Assert-True ($pluginServerText -match "case 'sync':[\s\S]{0,180}metadata\.signalDetected = true") 'El modo HD no exige sincronizacion NRSC-5 real.'
    Assert-True ($pluginServerText -notmatch "case 'mer':[\s\S]{0,180}metadata\.signalDetected = true") 'Un valor MER todavia clasifica falsamente una emisora analogica como HD.'
    Assert-True ($pluginServerText -match 'restartAnalogRds\(rtlCapture\)') 'La resintonia no reinicia Redsea ni limpia el RDS anterior.'
    Assert-True ($streamText -match 'anullsrc=r=48000') 'El modo RTL no contiene la reserva de audio base.'
    Assert-True ($endpointsText -notmatch 'videoDevices: result\.audioDevices|audioDevices: result\.videoDevices') 'La interfaz web intercambia las entradas de audio y video.'
    Assert-True ($streamText -match "rtbufsize', '64M") 'TEF conserva un bufer DirectShow demasiado pequeno.'
    Assert-True ($streamText -match 'aresample=async=1') 'TEF no corrige deriva ni huecos de la tarjeta de sonido.'
    Assert-True ($streamText -match 'receivedAudio') 'El error de audio no distingue una captura que ya entrega datos.'
    $parserText = Get-Content -Raw -LiteralPath (Join-Path $dist 'app\server\stream\parser.js')
    Assert-True ($parserText -match '\(audio\|video\)') 'El enumerador no reconoce el formato DirectShow actual.'
    Assert-True ($bridgeText -match 'librtlsdr\.dll') 'El enumerador Python no reconoce librtlsdr.dll.'
    Assert-True ($serverIndex -match 'rtlVirtualMode') 'El parche del nucleo RTL-SDR no se aplico al servidor.'
    Assert-True ($serverIndex -match 'allowPortableLocalTuning') 'La interfaz local no puede autorizar la sintonizacion RTL.'
    Assert-True ($serverIndex -match 'const ipv4Address = serverConfig\.webserver\.webserverIp;') 'El servidor IPv4 no se enlaza a todas las interfaces para la red local.'
    $passwordScript = Get-Content -Raw -LiteralPath (Join-Path $dist 'scripts\Configure-RemotePasswords.ps1')
    Assert-True ($passwordScript -match 'adminConfirm') 'El configurador no solicita confirmacion de contrasena.'
    Assert-True ($passwordScript -match 'Windows.Forms.CheckBox') 'El configurador no explica como ver la contrasena mientras se crea.'
    $networkScript = Get-Content -Raw -LiteralPath (Join-Path $dist 'scripts\Enable-Network.ps1')
    Assert-True ($networkScript -match 'RemoteAddress LocalSubnet') 'La regla LAN no esta limitada a la subred local.'
    $internetScript = Get-Content -Raw -LiteralPath (Join-Path $dist 'scripts\Publish-Internet.ps1')
    Assert-True ($internetScript -match 'trycloudflare|cloudflared') 'Falta el tunel HTTPS temporal para acceso exterior.'


    $node = Join-Path $dist 'runtime\node\node.exe'
    $python = Join-Path $dist 'runtime\python\python.exe'
    if (Test-Path -LiteralPath $node) {
    $mainUiText = Get-Content -Raw -LiteralPath (Join-Path $dist 'app\web\js\main.js')
    $pluginFrontendText = Get-Content -Raw -LiteralPath (Join-Path $dist 'app\plugins\NRSC5_HDRadio\NRSC5_HDRadio_frontend.js')
    Assert-True ($pluginFrontendText -match '_broadcastArtUrl \|\| _itunesArtUrl') 'Las imagenes LOT de HD Radio no tienen prioridad sobre la portada externa.'
    Assert-True ($pluginFrontendText -match 'HD RADIO ON') 'Falta el boton para reactivar HD Radio en la misma area.'
    Assert-True ($pluginFrontendText -match 'restartFmStreamAfterTune[\s\S]{0,900}activeStream\.Start') 'La sintonia no reanuda automaticamente el audio FM.'
    Assert-True ($pluginFrontendText -match 'portable-rf-readout') 'La interfaz no muestra SNR, dBm estimado y PI juntos.'
    Assert-True ($pluginServerText -match 'rtlSnrDb' -and $pluginServerText -match 'rtlPowerDbm') 'SNR y dBm no se publican como metricas independientes.'
    Assert-True ($pluginServerText -match 'lotImageCache[\s\S]{0,500}hd-radio-lot') 'Las imagenes HD no se conservan para reconexiones.'
    Assert-True ($dataHandlerText -match "dataToSend\.pi = value\.toString\(16\)") 'El decodificador RDS no publica el codigo PI.'
    Assert-True ($pluginFrontendText -match "txt\.textContent = 'FM ANALOG'") 'La interfaz no identifica explicitamente las estaciones analogicas.'
    Assert-True ($pluginFrontendText -match 'HD RADIO OFF') 'Falta el boton visible para forzar FM analogica en HD debil.'
        & $node --check (Join-Path $dist 'app\plugins\NRSC5_HDRadio\NRSC5_HDRadio_frontend_server.js')
        & $node --check (Join-Path $dist 'app\plugins\NRSC5_HDRadio\analog_rds.js')
    Assert-True ($pluginServerText -match 'retuneLive\(newFreq') 'La sintonia cambia reiniciando el receptor en vez de usar retune en vivo.'
    Assert-True ($pluginServerText -match "stdio: \['pipe', 'pipe', 'pipe', 'pipe'\]") 'El capturador RTL no conserva un canal de control para resintonizar.'
    Assert-True ($pluginServerText -match 'publishRtlMetric') 'Las metricas SNR del RTL no se publican en la interfaz.'
        Assert-True ($LASTEXITCODE -eq 0) 'El servidor JavaScript del plugin no pasa node --check.'
        & $node --check (Join-Path $dist 'app\server\stream\parser.js')
        & $node --check (Join-Path $dist 'app\server\stream\index.js')
        & $node --check (Join-Path $dist 'app\server\rtl_virtual_output.js')
        Assert-True ($LASTEXITCODE -eq 0) 'El adaptador virtual RTL-SDR no pasa node --check.'
    Assert-True ($mainUiText -match 'TIMEOUT_DURATION = 15000') 'La interfaz conserva el umbral WebSocket inestable de cinco segundos.'
    Assert-True ($mainUiText -notmatch 'messageCounter\+\+') 'La interfaz aun fuerza desconexiones periodicas aunque reciba datos.'
        Push-Location (Join-Path $dist 'app')
    Assert-True ($pluginServerText -match 'HD_SYNC_HOLD_MS = 8000') 'El audio HD no conserva estado ante perdidas breves de sincronizacion.'
    Assert-True ($pluginFrontendText -match 'HD signal lost[\s\S]{0,250}_preBufDur = 0') 'La perdida HD todavia destruye el canal en vez de continuar con FM.'
    Assert-True ($pluginFrontendText -match 'resetProgramAudio') 'La interfaz no limpia el audio anterior al cambiar de subcanal.'
    Assert-True ($pluginFrontendText -match 'b.disabled = !unlocked') 'La interfaz sigue bloqueando HD2/HD3 por metadatos tardios.'
        & $node --check (Join-Path $dist 'app\plugins\NRSC5_HDRadio\NRSC5_HDRadio_frontend_server.js')
        & $node --check (Join-Path $dist 'app\plugins\NRSC5_HDRadio\analog_rds.js')
        Assert-True ($LASTEXITCODE -eq 0) 'El servidor hibrido del plugin no pasa node --check.'
        try { & $node -e "require('express'); require('serialport'); require('ws')" }
        finally { Pop-Location }
        Assert-True ($LASTEXITCODE -eq 0) 'No se pueden cargar dependencias Node.js.'
    }
    if (Test-Path -LiteralPath $python) {
        & $python -c "import ast,pathlib,sys; [ast.parse(pathlib.Path(p).read_text(encoding='utf-8')) for p in sys.argv[1:]]" (Join-Path $dist 'app\plugins\NRSC5_HDRadio\hd_bridge.py') (Join-Path $dist 'app\plugins\NRSC5_HDRadio\nrsc5.py')
        Assert-True ($LASTEXITCODE -eq 0) 'El puente Python del paquete no compila.'
        & $python -m py_compile (Join-Path $dist 'app\plugins\NRSC5_HDRadio\hybrid_bridge.py')
        Assert-True ($LASTEXITCODE -eq 0) 'El puente hibrido de IQ no compila.'
    }
}
if ($failures.Count -gt 0) {
    Write-Host ''
    $failures | ForEach-Object { Write-Host "[ERROR] $_" -ForegroundColor Red }
    throw "$($failures.Count) prueba(s) fallaron."
}

Write-Host 'Todas las pruebas completadas correctamente.' -ForegroundColor Green
