param(
    [switch]$SkipDownloads,
    [switch]$SkipNpm,
    [switch]$ForceRuntimes
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')
Assert-WindowsX64

$root = Get-ProjectRoot
$manifest = Get-ProjectManifest
$thirdParty = Join-Path $root 'third_party'
$sourceFmdx = Join-Path $thirdParty 'fm-dx-webserver'
$sourcePlugin = Join-Path $thirdParty 'NRSC5_HDRadio\NRSC5_HDRadio'
$sourceSpectrum = Join-Path $thirdParty 'SpectrumGraph'

foreach ($required in @($sourceFmdx, $sourcePlugin, (Join-Path $thirdParty 'airspyhf'), (Join-Path $thirdParty 'nrsc5'), (Join-Path $thirdParty 'nrsc5-gui'), (Join-Path $thirdParty 'redsea'), (Join-Path $thirdParty 'liquid-dsp'), $sourceSpectrum)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Falta una fuente requerida: $required. Ejecute git submodule update --init --recursive."
    }
}

if (-not $SkipDownloads) {
    & (Join-Path $PSScriptRoot 'Get-Runtimes.ps1') -Force:$ForceRuntimes
    & (Join-Path $PSScriptRoot 'Build-Nrsc5.ps1') -Force:$ForceRuntimes
}

$node = Join-Path $root 'runtime\node\node.exe'
$npm = Join-Path $root 'runtime\node\npm.cmd'
$python = Join-Path $root 'runtime\python\python.exe'
$nrsc5 = Join-Path $root 'runtime\nrsc5\libnrsc5.dll'
$rtlHybrid = Join-Path $root 'runtime\nrsc5\rtl_hybrid.exe'
$airspyHybrid = Join-Path $root 'runtime\nrsc5\airspyhf_hybrid.exe'
$redsea = Join-Path $root 'runtime\nrsc5\redsea.exe'
foreach ($required in @($node, $npm, $python, $nrsc5, $rtlHybrid, $airspyHybrid, $redsea)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Runtime faltante: $required" }
}

function Merge-ConfigDefaults([object]$Active, [object]$Defaults) {
    foreach ($property in $Defaults.PSObject.Properties) {
        $existing = $Active.PSObject.Properties[$property.Name]
        if (-not $existing) {
            $Active | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value
            continue
        }
        if ($existing.Value -is [pscustomobject] -and $property.Value -is [pscustomobject]) {
            Merge-ConfigDefaults $existing.Value $property.Value
        }
    }
}
$distRoot = Join-Path $root 'dist\FM-DX-Windows-Portable'
$appDir = Join-Path $distRoot 'app'
$existingMainPath = Join-Path $appDir 'config.json'
$existingHdPath = Join-Path $appDir 'plugins_configs\NRSC5_HDRadio.json'
$preservedMainConfig = $null
$preservedHdConfig = $null
try {
    if (Test-Path -LiteralPath $existingMainPath) {
        $preservedMainConfig = Get-Content -Raw -LiteralPath $existingMainPath | ConvertFrom-Json
    }
    if (Test-Path -LiteralPath $existingHdPath) {
        $preservedHdConfig = Get-Content -Raw -LiteralPath $existingHdPath | ConvertFrom-Json
    }
} catch {
    Write-Warning 'No se pudo leer la configuracion activa; se usaran las plantillas.'
    $preservedMainConfig = $null
    $preservedHdConfig = $null
}
Write-Step 'Preparando la distribución limpia'
Reset-ProjectDirectory $distRoot
Copy-DirectoryContents $sourceFmdx $appDir @('.git')

# FM-DX upstream assumes an interactive terminal. Use a safe width for CI,
# scheduled tasks and redirected output.
$serverIndexPath = Join-Path $appDir 'server\index.js'
$serverIndexText = [System.IO.File]::ReadAllText($serverIndexPath)
$serverIndexText = $serverIndexText.Replace('}).output.columns;', '}).output.columns || 80;')
$lanBindOld = "const ipv4Address = serverConfig.webserver.webserverIp === '0.0.0.0' ? 'localhost' : serverConfig.webserver.webserverIp;"
if (-not $serverIndexText.Contains($lanBindOld)) { throw 'No se encontro el enlace IPv4 esperado del servidor.' }
$serverIndexText = $serverIndexText.Replace($lanBindOld, 'const ipv4Address = serverConfig.webserver.webserverIp;')
[System.IO.File]::WriteAllText($serverIndexPath, $serverIndexText, [System.Text.UTF8Encoding]::new($false))
$endpointsPath = Join-Path $appDir 'server\endpoints.js'
$endpointsText = [System.IO.File]::ReadAllText($endpointsPath)
if (($endpointsText.Split('videoDevices: result.audioDevices').Count - 1) -lt 1 -or ($endpointsText.Split('audioDevices: result.videoDevices').Count - 1) -lt 1) {
    throw 'No se encontro el intercambio heredado de dispositivos en endpoints.js.'
}
$endpointsText = $endpointsText.Replace('videoDevices: result.audioDevices', 'videoDevices: __FMDX_VIDEO_DEVICES__')
$endpointsText = $endpointsText.Replace('audioDevices: result.videoDevices', 'audioDevices: result.audioDevices')
$endpointsText = $endpointsText.Replace('videoDevices: __FMDX_VIDEO_DEVICES__', 'videoDevices: result.videoDevices')
[System.IO.File]::WriteAllText($endpointsPath, $endpointsText, [System.Text.UTF8Encoding]::new($false))
$rtlPatch = Join-Path $root 'patches\fm-dx-webserver-rtl.patch'
$gitCommand = (Get-Command git -ErrorAction Stop).Source
$gitInstall = Split-Path -Parent (Split-Path -Parent $gitCommand)
$patchCommand = Join-Path $gitInstall 'usr\bin\patch.exe'
if (-not (Test-Path -LiteralPath $patchCommand)) { throw "No se encontro patch.exe junto a Git: $patchCommand" }
$stabilityPatch = Join-Path $root 'patches\fm-dx-webserver-stability.patch'
$oldLocation = Get-Location
try {
    Set-Location -LiteralPath $appDir
    & $patchCommand -p1 -i $rtlPatch
    if ($LASTEXITCODE -ne 0) { throw "No se pudo aplicar el parche RTL-SDR." }
    & $patchCommand -p1 -l -i $stabilityPatch
    if ($LASTEXITCODE -ne 0) { throw "No se pudo aplicar el parche de estabilidad WebSocket." }
} finally {
    Set-Location $oldLocation
}
& (Join-Path $root 'scripts\Apply-Tuner-Lock-Fix.ps1') -AppDir $appDir
$dataHandlerPath = Join-Path $appDir 'server\datahandler.js'
$dataHandlerText = [System.IO.File]::ReadAllText($dataHandlerPath)
$dataHandlerExport = 'handleData, showOnlineUsers, dataToSend, initialData, resetToDefault, state'
if (-not $dataHandlerText.Contains($dataHandlerExport)) { throw 'No se encontro la exportacion esperada de datahandler.js.' }
$dataHandlerText = $dataHandlerText.Replace($dataHandlerExport, 'handleData, showOnlineUsers, dataToSend, initialData, resetToDefault, resetRds: rdsReset, state')
$piPattern = 'value = rdsparser\.get_pi\(rds\)\r?\n\s*//console\.log\(''PI: '' \+ value\.toString\(16\)\.toUpperCase\(\)\)'
if (-not [regex]::IsMatch($dataHandlerText, $piPattern)) { throw 'No se encontro el callback PI esperado de datahandler.js.' }
$piReplacement = "value = rdsparser.get_pi(rds),`r`n    dataToSend.pi = value.toString(16).toUpperCase().padStart(4, '0')"
$dataHandlerText = [regex]::Replace($dataHandlerText, $piPattern, $piReplacement, 1)
[System.IO.File]::WriteAllText($dataHandlerPath, $dataHandlerText, [System.Text.UTF8Encoding]::new($false))

Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\server\rtl_virtual_output.js') -Destination (Join-Path $appDir 'server\rtl_virtual_output.js') -Force
Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\server\tuning_access.js') -Destination (Join-Path $appDir 'server\tuning_access.js') -Force
$streamDir = Join-Path $appDir 'server\stream'
Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\server\stream\parser.js') -Destination (Join-Path $streamDir 'parser.js') -Force
Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\server\stream\index.js') -Destination (Join-Path $streamDir 'index.js') -Force

$pluginDir = Join-Path $appDir 'plugins\NRSC5_HDRadio'
New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
Copy-DirectoryContents $sourcePlugin $pluginDir @('setup.ps1', 'setup.bat', 'setup.sh')
$bridgePath = Join-Path $pluginDir 'hd_bridge.py'
$bridgeText = [System.IO.File]::ReadAllText($bridgePath)
$rtlDllNames = '"Windows": ["rtlsdr.dll"],'
if (-not $bridgeText.Contains($rtlDllNames)) { throw 'No se encontro la lista DLL de RTL-SDR esperada en hd_bridge.py.' }
$bridgeText = $bridgeText.Replace($rtlDllNames, '"Windows": ["rtlsdr.dll", "librtlsdr.dll"],')
$pluginPatch = Join-Path $root 'patches\nrsc5-plugin-hybrid.patch'
$pluginStabilityPatch = Join-Path $root 'patches\nrsc5-plugin-stability.patch'
$pluginAudioStabilityPatch = Join-Path $root 'patches\nrsc5-audio-stability.patch'
$pluginCf32Patch = Join-Path $root 'patches\nrsc5-python-cf32.patch'
$pluginSubchannelsPatch = Join-Path $root 'patches\nrsc5-subchannels.patch'
$oldLocation = Get-Location
try {
    Set-Location -LiteralPath $pluginDir
    & $patchCommand -p1 -i $pluginPatch
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo aplicar el parche hibrido del plugin NRSC-5.' }
    & $patchCommand -p1 -i $pluginStabilityPatch
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo aplicar la estabilidad de sincronizacion NRSC-5.' }
    & $patchCommand -p1 -i $pluginCf32Patch
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo habilitar la entrada CF32 de Airspy HF+.' }
} finally {
    & $patchCommand -p1 -i $pluginAudioStabilityPatch
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo aplicar la continuidad de audio FM/HD.' }
    & $patchCommand -p1 -i $pluginSubchannelsPatch
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo habilitar la seleccion de subcanales HD.' }
    Set-Location $oldLocation
}
Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\plugins\NRSC5_HDRadio\hybrid_bridge.py') `
    -Destination (Join-Path $pluginDir 'hybrid_bridge.py') -Force

Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\plugins\NRSC5_HDRadio\NRSC5_HDRadio_frontend_server.js') -Destination (Join-Path $pluginDir 'NRSC5_HDRadio_frontend_server.js') -Force
Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\plugins\NRSC5_HDRadio\NRSC5_HDRadio_frontend.js') -Destination (Join-Path $pluginDir 'NRSC5_HDRadio_frontend.js') -Force
Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\plugins\NRSC5_HDRadio\analog_rds.js') -Destination (Join-Path $pluginDir 'analog_rds.js') -Force
Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\plugins\NRSC5_HDRadio\spectrum_analyzer.js') -Destination (Join-Path $pluginDir 'spectrum_analyzer.js') -Force

[System.IO.File]::WriteAllText($bridgePath, $bridgeText, [System.Text.UTF8Encoding]::new($false))

Copy-DirectoryContents (Join-Path $root 'runtime\nrsc5') $pluginDir @('licenses', 'manifest.json')
Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\plugins\NRSC5_HDRadio.js') -Destination (Join-Path $appDir 'plugins\NRSC5_HDRadio.js') -Force
$spectrumDir = Join-Path $appDir 'plugins\SpectrumGraph'
New-Item -ItemType Directory -Path $spectrumDir -Force | Out-Null
$spectrumFrontendSource = [IO.File]::ReadAllText((Join-Path $sourceSpectrum 'SpectrumGraph\pluginSpectrumGraph.js'))
$spectrumFrontendWrapped = "(() => {" + [Environment]::NewLine + $spectrumFrontendSource + [Environment]::NewLine + "})();" + [Environment]::NewLine
[IO.File]::WriteAllText((Join-Path $spectrumDir 'pluginSpectrumGraph.js'), $spectrumFrontendWrapped, [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\plugins\SpectrumGraph\pluginSpectrumGraph_server.js') -Destination (Join-Path $spectrumDir 'pluginSpectrumGraph_server.js') -Force
Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\plugins\SpectrumGraph.js') -Destination (Join-Path $appDir 'plugins\SpectrumGraph.js') -Force

$pluginsConfigDir = Join-Path $appDir 'plugins_configs'
New-Item -ItemType Directory -Path $pluginsConfigDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'config\config.json') -Destination (Join-Path $appDir 'config.json') -Force
Copy-Item -LiteralPath (Join-Path $root 'config\NRSC5_HDRadio.json') -Destination (Join-Path $pluginsConfigDir 'NRSC5_HDRadio.json') -Force
if ($preservedMainConfig) {
    $mainDefaults = Get-Content -Raw -LiteralPath (Join-Path $appDir 'config.json') | ConvertFrom-Json
    $hadTuningAccess = $null -ne $preservedMainConfig.PSObject.Properties['tuningAccess']
    Merge-ConfigDefaults $preservedMainConfig $mainDefaults
    if (-not $hadTuningAccess) {
        $preservedMainConfig.tuningAccess.mode = if ($preservedMainConfig.lockToAdmin) { 'admin' } elseif ($preservedMainConfig.publicTuner) { 'public' } else { 'limited' }
    }
    $preservedMainConfig.plugins = @($mainDefaults.plugins + $preservedMainConfig.plugins | Select-Object -Unique)
    Save-JsonUtf8 $preservedMainConfig (Join-Path $appDir 'config.json')
    Write-Ok 'Configuracion activa y contrasenas conservadas.'
}
if ($preservedHdConfig) {
    $hdDefaults = Get-Content -Raw -LiteralPath (Join-Path $pluginsConfigDir 'NRSC5_HDRadio.json') | ConvertFrom-Json
    Merge-ConfigDefaults $preservedHdConfig $hdDefaults
    Save-JsonUtf8 $preservedHdConfig (Join-Path $pluginsConfigDir 'NRSC5_HDRadio.json')
    Write-Ok 'Configuracion activa del receptor conservada.'
}
Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\tools\list-audio-devices.js') -Destination (Join-Path $appDir 'list-audio-devices.js') -Force

New-Item -ItemType Directory -Path (Join-Path $distRoot 'runtime') -Force | Out-Null
Copy-DirectoryContents (Join-Path $root 'runtime\node') (Join-Path $distRoot 'runtime\node')
Copy-DirectoryContents (Join-Path $root 'runtime\python') (Join-Path $distRoot 'runtime\python')

if (-not $SkipNpm) {
    Write-Step 'Instalando dependencias Node.js fijadas por package-lock.json'
    $env:PATH = (Join-Path $root 'runtime\node') + ';' + $env:PATH
    $env:npm_config_audit = 'false'
    $env:npm_config_fund = 'false'
    Invoke-Checked $npm @('ci', '--omit=dev') $appDir
}

foreach ($file in @('Iniciar.cmd', 'Configurar.cmd', 'Diagnostico.cmd', 'Configurar-Contrasenas.cmd', 'Habilitar-Red-Local.cmd', 'Publicar-Internet.cmd')) {
    Copy-Item -LiteralPath (Join-Path $root "packaging\$file") -Destination (Join-Path $distRoot $file) -Force
}
Copy-DirectoryContents (Join-Path $root 'packaging\scripts') (Join-Path $distRoot 'scripts')
Copy-Item -LiteralPath (Join-Path $root 'README.md') -Destination (Join-Path $distRoot 'LEEME.md') -Force
Copy-Item -LiteralPath (Join-Path $root 'THIRD_PARTY_NOTICES.md') -Destination (Join-Path $distRoot 'THIRD_PARTY_NOTICES.md') -Force
Copy-Item -LiteralPath (Join-Path $root 'project.json') -Destination (Join-Path $distRoot 'project.json') -Force

$licenses = Join-Path $distRoot 'licenses'
New-Item -ItemType Directory -Path $licenses -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $thirdParty 'fm-dx-webserver\LICENSE') -Destination (Join-Path $licenses 'fm-dx-webserver-GPL-3.0.txt') -Force
Copy-Item -LiteralPath (Join-Path $thirdParty 'nrsc5\LICENSE') -Destination (Join-Path $licenses 'nrsc5-GPL-3.0.txt') -Force
Copy-Item -LiteralPath (Join-Path $sourceSpectrum 'LICENSE') -Destination (Join-Path $licenses 'SpectrumGraph-MIT.txt') -Force
if (Test-Path -LiteralPath (Join-Path $root 'runtime\nrsc5\licenses')) {
    Copy-Item -LiteralPath (Join-Path $root 'runtime\nrsc5\licenses') -Destination $licenses -Recurse -Force
}

$buildInfo = [ordered]@{
    product = $manifest.name
    version = $manifest.version
    generatedAt = [DateTime]::UtcNow.ToString('o')
    upstream = $manifest.upstream
    runtimes = $manifest.runtimes
}
Save-JsonUtf8 $buildInfo (Join-Path $distRoot 'build-info.json')

Write-Step 'Validando el paquete ensamblado'
& (Join-Path $root 'tests\Test-Project.ps1') -DistributionPath $distRoot
Write-Ok "Paquete terminado: $distRoot"
