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
$sourceTime = Join-Path $thirdParty 'webserver-time'
$sourceTimeOverlay = Join-Path $root 'overlays\fm-dx-webserver\plugins'

foreach ($required in @($sourceFmdx, $sourcePlugin, (Join-Path $thirdParty 'airspyhf'), (Join-Path $thirdParty 'nrsc5'), (Join-Path $thirdParty 'nrsc5-gui'), (Join-Path $thirdParty 'redsea'), (Join-Path $thirdParty 'liquid-dsp'), $sourceSpectrum, $sourceTime)) {
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

$distRoot = Join-Path $root 'dist\FM-DX-Windows-Portable'
$appDir = Join-Path $distRoot 'app'
Write-Step 'Preparando la distribuciÃƒÆ’Ã‚Â³n limpia'
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
$endpointsText = $endpointsText.Replace('const updatedConfig = loadConfig();', 'const updatedConfig = loadCurrentConfig();')
$authPattern = 'const loginAttempts = \{\};[\s\S]*?(?=// Route for login)'
$authReplacement = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('Y29uc3QgbG9naW5BdHRlbXB0cyA9IHt9OyAvLyBGb3JtYXQ6IHsgJ2lwJzogeyBjb3VudDogMSwgbGFzdEF0dGVtcHQ6IDEyMzQ1Njc4OTAgfSB9CmNvbnN0IE1BWF9BVFRFTVBUUyA9IDI1Owpjb25zdCBXSU5ET1dfTVMgPSAxNSAqIDYwICogMTAwMDsKCmZ1bmN0aW9uIGxvYWRDdXJyZW50Q29uZmlnKCkgewogICAgdHJ5IHsKICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShmcy5yZWFkRmlsZVN5bmMoY29uZmlnUGF0aCwgJ3V0ZjgnKSk7CiAgICB9IGNhdGNoIChlcnIpIHsKICAgICAgICBsb2dFcnJvcihgVW5hYmxlIHRvIHJlbG9hZCBjb25maWcgZm9yIGF1dGhlbnRpY2F0aW9uOiAke2Vyci5tZXNzYWdlfWApOwogICAgICAgIHJldHVybiBzZXJ2ZXJDb25maWc7CiAgICB9Cn0KCmNvbnN0IGF1dGhlbnRpY2F0ZSA9IChyZXEsIHJlcywgbmV4dCkgPT4gewogICAgY29uc3QgaXAgPSByZXEuaXAgfHwgcmVxLmNvbm5lY3Rpb24ucmVtb3RlQWRkcmVzczsKICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7CgogICAgaWYgKCFsb2dpbkF0dGVtcHRzW2lwXSB8fCBub3cgLSBsb2dpbkF0dGVtcHRzW2lwXS5sYXN0QXR0ZW1wdCA+IFdJTkRPV19NUykgewogICAgICAgIGxvZ2luQXR0ZW1wdHNbaXBdID0geyBjb3VudDogMCwgbGFzdEF0dGVtcHQ6IG5vdyB9OwogICAgfQoKICAgIGNvbnN0IHBhc3N3b3JkID0gdHlwZW9mIHJlcS5ib2R5Py5wYXNzd29yZCA9PT0gJ3N0cmluZycgPyByZXEuYm9keS5wYXNzd29yZCA6ICcnOwogICAgY29uc3QgY3VycmVudENvbmZpZyA9IGxvYWRDdXJyZW50Q29uZmlnKCk7CiAgICBjb25zdCBjdXJyZW50UGFzc3dvcmRzID0gY3VycmVudENvbmZpZy5wYXNzd29yZCB8fCB7fTsKICAgIGNvbnN0IGFkbWluUGFzcyA9IHR5cGVvZiBjdXJyZW50UGFzc3dvcmRzLmFkbWluUGFzcyA9PT0gJ3N0cmluZycgPyBjdXJyZW50UGFzc3dvcmRzLmFkbWluUGFzcyA6ICcnOwogICAgY29uc3QgdHVuZVBhc3MgPSB0eXBlb2YgY3VycmVudFBhc3N3b3Jkcy50dW5lUGFzcyA9PT0gJ3N0cmluZycgPyBjdXJyZW50UGFzc3dvcmRzLnR1bmVQYXNzIDogJyc7CiAgICBjb25zdCBpc0FkbWluUGFzc3dvcmQgPSBhZG1pblBhc3MubGVuZ3RoID4gMCAmJiBwYXNzd29yZCA9PT0gYWRtaW5QYXNzOwogICAgY29uc3QgaXNUdW5lUGFzc3dvcmQgPSB0dW5lUGFzcy5sZW5ndGggPiAwICYmIHBhc3N3b3JkID09PSB0dW5lUGFzczsKCiAgICAvLyBBIG5ld2x5IGdlbmVyYXRlZCBjb3JyZWN0IHBhc3N3b3JkIG11c3Qgd29yayBldmVuIGlmIG9sZGVyIGZhaWxlZCBhdHRlbXB0cyByZWFjaGVkIHRoZSBsaW1pdC4KICAgIGlmIChsb2dpbkF0dGVtcHRzW2lwXS5jb3VudCA+PSBNQVhfQVRURU1QVFMgJiYgIWlzQWRtaW5QYXNzd29yZCAmJiAhaXNUdW5lUGFzc3dvcmQpIHsKICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDMpLmpzb24oewogICAgICAgICAgICBtZXNzYWdlOiAnVG9vIG1hbnkgbG9naW4gYXR0ZW1wdHMuIFBsZWFzZSB0cnkgYWdhaW4gbGF0ZXIuJwogICAgICAgIH0pOwogICAgfQoKICAgIGxvZ2luQXR0ZW1wdHNbaXBdLmxhc3RBdHRlbXB0ID0gbm93OwoKICAgIGlmIChpc0FkbWluUGFzc3dvcmQpIHsKICAgICAgICBzZXJ2ZXJDb25maWcucGFzc3dvcmQgPSB7IC4uLnNlcnZlckNvbmZpZy5wYXNzd29yZCwgLi4uY3VycmVudFBhc3N3b3JkcyB9OwogICAgICAgIHJlcS5zZXNzaW9uLmlzQWRtaW5BdXRoZW50aWNhdGVkID0gdHJ1ZTsKICAgICAgICByZXEuc2Vzc2lvbi5pc1R1bmVBdXRoZW50aWNhdGVkID0gdHJ1ZTsKICAgICAgICBsb2dJbmZvKGBVc2VyIGZyb20gJHtpcH0gbG9nZ2VkIGluIGFzIGFuIGFkbWluaXN0cmF0b3IuYCk7CiAgICAgICAgbG9naW5BdHRlbXB0c1tpcF0uY291bnQgPSAwOwogICAgICAgIG5leHQoKTsKICAgIH0gZWxzZSBpZiAoaXNUdW5lUGFzc3dvcmQpIHsKICAgICAgICBzZXJ2ZXJDb25maWcucGFzc3dvcmQgPSB7IC4uLnNlcnZlckNvbmZpZy5wYXNzd29yZCwgLi4uY3VycmVudFBhc3N3b3JkcyB9OwogICAgICAgIHJlcS5zZXNzaW9uLmlzQWRtaW5BdXRoZW50aWNhdGVkID0gZmFsc2U7CiAgICAgICAgcmVxLnNlc3Npb24uaXNUdW5lQXV0aGVudGljYXRlZCA9IHRydWU7CiAgICAgICAgbG9nSW5mbyhgVXNlciBmcm9tICR7aXB9IGxvZ2dlZCBpbiB3aXRoIHR1bmUgcGVybWlzc2lvbnMuYCk7CiAgICAgICAgbG9naW5BdHRlbXB0c1tpcF0uY291bnQgPSAwOwogICAgICAgIG5leHQoKTsKICAgIH0gZWxzZSB7CiAgICAgICAgbG9naW5BdHRlbXB0c1tpcF0uY291bnQgKz0gMTsKICAgICAgICByZXMuc3RhdHVzKDQwMykuanNvbih7IG1lc3NhZ2U6ICdMb2dpbiBmYWlsZWQuIFdyb25nIHBhc3N3b3JkPycgfSk7CiAgICB9Cn07Cg=='))
if (-not [regex]::IsMatch($endpointsText, $authPattern)) { throw 'No se encontro el bloque de autenticacion de endpoints.js.' }
$endpointsText = [regex]::Replace($endpointsText, $authPattern, $authReplacement, 1)
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
$serverIndexText = [IO.File]::ReadAllText($serverIndexPath)
$declarationPattern = 'const tunerLockTracker = new WeakMap\(\);'
$declarationReplacement = @"
const tunerLockTracker = new WeakMap();
const { createTuningAccess } = require('./tuning_access');
const tuningAccess = createTuningAccess({ getConfig: () => serverConfig, logInfo });
"@.TrimEnd()
if (([regex]::Matches($serverIndexText, $declarationPattern)).Count -ne 1) { throw 'No se encontro tunerLockTracker.' }
$serverIndexText = [regex]::Replace($serverIndexText, $declarationPattern, $declarationReplacement, 1)
$clientKeyPattern = [regex]::Escape("const normalizedClientIp = clientIp?.replace(/^::ffff:/, '');")
$clientKeyReplacement = "const normalizedClientIp = clientIp?.replace(/^::ffff:/, '');`n    const tuningSessionKey = request.sessionID || normalizedClientIp || clientIp;"
if (([regex]::Matches($serverIndexText, $clientKeyPattern)).Count -ne 1) { throw 'No se encontro normalizedClientIp.' }
$serverIndexText = [regex]::Replace($serverIndexText, $clientKeyPattern, $clientKeyReplacement, 1)
$authOld = @'
const allowPortableLocalTuning = rtlVirtualMode && (normalizedClientIp === '127.0.0.1' || normalizedClientIp === '::1');         if (allowPortableLocalTuning || (serverConfig.publicTuner && !serverConfig.lockToAdmin) || isAdminAuthenticated || (!serverConfig.publicTuner && !serverConfig.lockToAdmin && isTuneAuthenticated)) {             output.write(`${command}\n`);         }
'@.Trim().Replace("`r`n", "`n")
$authReplacement = @'
const allowPortableLocalTuning = rtlVirtualMode && (normalizedClientIp === '127.0.0.1' || normalizedClientIp === '::1');         let commandAllowed = allowPortableLocalTuning || (serverConfig.publicTuner && !serverConfig.lockToAdmin) || isAdminAuthenticated || (!serverConfig.publicTuner && !serverConfig.lockToAdmin && isTuneAuthenticated);         if (commandAllowed && command.startsWith('T') && serverConfig.publicTuner && !serverConfig.lockToAdmin && !isAdminAuthenticated && !allowPortableLocalTuning) {             const lease = tuningAccess.acquire(tuningSessionKey);             if (!lease.allowed) {                 try { ws.send(JSON.stringify({ type: 'tuning-access-denied', value: lease })); } catch (_) {}                 commandAllowed = false;             }         }         if (commandAllowed) output.write(`${command}\n`);
'@.Trim().Replace("`r`n", "`n")
if (-not $serverIndexText.Contains($authOld)) { throw 'No se encontro el bloque de autorizacion de sintonia.' }
$serverIndexText = $serverIndexText.Replace($authOld, $authReplacement)
$closePattern = "ws\.on\('close', \(code, reason\) => \{"
$closeReplacement = "ws.on('close', (code, reason) => {`n      tuningAccess.release(tuningSessionKey);"
if (([regex]::Matches($serverIndexText, $closePattern)).Count -ne 1) { throw 'No se encontro el cierre WebSocket principal.' }
$serverIndexText = [regex]::Replace($serverIndexText, $closePattern, $closeReplacement, 1)
$serverIndexText = $serverIndexText.Replace("serverConfig.publicTuner = true; `n                    if(!isAdminAuthenticated)", "serverConfig.publicTuner = true; `n                    if (isAdminAuthenticated) configSave();`n                    if(!isAdminAuthenticated)")
$serverIndexText = $serverIndexText.Replace("serverConfig.publicTuner = false;`n                    if(!isAdminAuthenticated)", "serverConfig.publicTuner = false;`n                    if (isAdminAuthenticated) configSave();`n                    if(!isAdminAuthenticated)")
[IO.File]::WriteAllText($serverIndexPath, $serverIndexText, [Text.UTF8Encoding]::new($false))

$setupPath = Join-Path $appDir 'web\setup.ejs'
$setupText = [IO.File]::ReadAllText($setupPath)
$setupAnchor = "                            <%- include('_components', {component: 'checkbox', cssClass: '', label: 'Admin lock', id: 'lockToAdmin'}) %><br>"
$setupControls = @"
$setupAnchor
                            <%- include('_components', {component: 'dropdown', cssClass: 'w-150', label: 'Usuarios que pueden sintonizar', id: 'tuning-access-users', inputId: 'tuningAccess-maxControllers', placeholder: '', options: [{value: 1, label: '1 usuario'}, {value: 2, label: '2 usuarios'}]}) %>
                            <%- include('_components', {component: 'dropdown', cssClass: 'w-150', label: 'Tiempo por sesion', id: 'tuning-access-minutes', inputId: 'tuningAccess-sessionMinutes', placeholder: '', options: [{value: 30, label: '30 minutos'}, {value: 60, label: '60 minutos'}]}) %><br>
"@.TrimEnd()
if (-not $setupText.Contains($setupAnchor)) { throw 'No se encontro Quick settings en setup.ejs.' }
$setupText = $setupText.Replace($setupAnchor, $setupControls)
[IO.File]::WriteAllText($setupPath, $setupText, [Text.UTF8Encoding]::new($false))
$mainUiPath = Join-Path $appDir 'web\js\main.js'
$mainUiText = [IO.File]::ReadAllText($mainUiPath)
$deniedNeedle = '    parsedData = JSON.parse(event.data);'
$deniedNotice = @'
    parsedData = JSON.parse(event.data);
    if (parsedData?.type === 'tuning-access-denied') {
        const access = parsedData.value || {};
        sendToast('warning', 'SintonÃƒÂ­a ocupada', `Ya hay ${access.active || access.maxControllers} usuario(s) controlando. Intente cuando se libere un cupo.`, false, false);
        return;
    }
'@.TrimEnd().Replace("`r`n", "`n")
if (-not $mainUiText.Contains($deniedNeedle)) { throw 'No se encontro el manejador WebSocket de la interfaz.' }
$mainUiText = $mainUiText.Replace($deniedNeedle, $deniedNotice)
[IO.File]::WriteAllText($mainUiPath, $mainUiText, [Text.UTF8Encoding]::new($false))

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
$spectrumFrontendWrapped = "(() => {`r`n" + $spectrumFrontendSource + "`r`n})();`r`n"
[IO.File]::WriteAllText((Join-Path $spectrumDir 'pluginSpectrumGraph.js'), $spectrumFrontendWrapped, [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\plugins\SpectrumGraph\pluginSpectrumGraph_server.js') -Destination (Join-Path $spectrumDir 'pluginSpectrumGraph_server.js') -Force
Copy-Item -LiteralPath (Join-Path $root 'overlays\fm-dx-webserver\plugins\SpectrumGraph.js') -Destination (Join-Path $appDir 'plugins\SpectrumGraph.js') -Force
$timeDir = Join-Path $appDir 'plugins\TimeDisplay'
New-Item -ItemType Directory -Path $timeDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceTimeOverlay 'TimeDisplay\timedisplay.js') -Destination (Join-Path $timeDir 'timedisplay.js') -Force
Copy-Item -LiteralPath (Join-Path $sourceTimeOverlay 'TimeDisplay\timedisplay_server.js') -Destination (Join-Path $timeDir 'timedisplay_server.js') -Force
Copy-Item -LiteralPath (Join-Path $sourceTimeOverlay 'TimeDisplayPlugin.js') -Destination (Join-Path $appDir 'plugins\TimeDisplayPlugin.js') -Force

$pluginsConfigDir = Join-Path $appDir 'plugins_configs'
New-Item -ItemType Directory -Path $pluginsConfigDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'config\config.json') -Destination (Join-Path $appDir 'config.json') -Force
Copy-Item -LiteralPath (Join-Path $root 'config\NRSC5_HDRadio.json') -Destination (Join-Path $pluginsConfigDir 'NRSC5_HDRadio.json') -Force
Copy-Item -LiteralPath (Join-Path $root 'config\TimeDisplay.json') -Destination (Join-Path $pluginsConfigDir 'TimeDisplay.json') -Force
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
Copy-Item -LiteralPath (Join-Path $root 'CHANGELOG.md') -Destination (Join-Path $distRoot 'CHANGELOG.md') -Force
Copy-Item -LiteralPath (Join-Path $root 'docs\ACTUALIZACION_DESDE_GITHUB.md') -Destination (Join-Path $distRoot 'ACTUALIZACION_DESDE_GITHUB.md') -Force
Copy-Item -LiteralPath (Join-Path $root 'THIRD_PARTY_NOTICES.md') -Destination (Join-Path $distRoot 'THIRD_PARTY_NOTICES.md') -Force
Copy-Item -LiteralPath (Join-Path $root 'project.json') -Destination (Join-Path $distRoot 'project.json') -Force

$licenses = Join-Path $distRoot 'licenses'
New-Item -ItemType Directory -Path $licenses -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $thirdParty 'fm-dx-webserver\LICENSE') -Destination (Join-Path $licenses 'fm-dx-webserver-GPL-3.0.txt') -Force
Copy-Item -LiteralPath (Join-Path $thirdParty 'nrsc5\LICENSE') -Destination (Join-Path $licenses 'nrsc5-GPL-3.0.txt') -Force
Copy-Item -LiteralPath (Join-Path $sourceSpectrum 'LICENSE') -Destination (Join-Path $licenses 'SpectrumGraph-MIT.txt') -Force
Copy-Item -LiteralPath (Join-Path $sourceTime 'LICENSE') -Destination (Join-Path $licenses 'webserver-time-GPL-3.0.txt') -Force
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
