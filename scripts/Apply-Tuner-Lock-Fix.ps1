param(
    [Parameter(Mandatory = $true)]
    [string]$AppDir
)
$ErrorActionPreference = 'Stop'
$serverPath = Join-Path $AppDir 'server\index.js'
$viewPath = Join-Path $AppDir 'web\index.ejs'
$setupPath = Join-Path $AppDir 'web\setup.ejs'
$mainJsPath = Join-Path $AppDir 'web\js\main.js'
foreach ($required in @($serverPath, $viewPath, $setupPath, $mainJsPath)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "No se encontro $required" }
}
$text = [IO.File]::ReadAllText($serverPath)
$declaration = 'const tunerLockTracker = new WeakMap();'
$guard = @'
const { createTuningAccess } = require('./tuning_access');
const tuningAccess = createTuningAccess({ getConfig: () => serverConfig, logInfo });
const TUNER_HEARTBEAT_MS = 30000;

function syncTuningLegacyFlags() {
    const mode = tuningAccess.status().mode;
    serverConfig.publicTuner = mode === 'public';
    serverConfig.lockToAdmin = mode === 'admin';
}

function setTuningMode(mode) {
    if (!serverConfig.tuningAccess || typeof serverConfig.tuningAccess !== 'object') {
        serverConfig.tuningAccess = {};
    }
    serverConfig.tuningAccess.mode = mode;
    tuningAccess.clear();
    syncTuningLegacyFlags();
    configSave();
    logInfo('Tuning access mode changed to ' + mode + '.');
}

syncTuningLegacyFlags();

const tunerHeartbeat = setInterval(() => {
    for (const socket of wss.clients) {
        if (socket.isAlive === false) {
            socket.terminate();
            continue;
        }
        socket.isAlive = false;
        try { socket.ping(); } catch (_) { socket.terminate(); }
    }
}, TUNER_HEARTBEAT_MS);
tunerHeartbeat.unref?.();
'@
if (-not $text.Contains($declaration)) { throw 'No se encontro tunerLockTracker en server/index.js.' }
$text = $text.Replace($declaration, $guard.TrimEnd())
$connectionAnchor = "    const normalizedClientIp = clientIp?.replace(/^::ffff:/, '');"
$connectionReplacement = @"
$connectionAnchor
    const tuningSessionKey = request.sessionID || normalizedClientIp || clientIp;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
"@.TrimEnd()
if (-not $text.Contains($connectionAnchor)) { throw 'No se encontro normalizedClientIp en server/index.js.' }
$text = $text.Replace($connectionAnchor, $connectionReplacement)
$switchPattern = "(?s)                case 'wL1':.*?                default:\s*\r?\n                    break;"
$switchReplacement = @'
                case 'wL1':
                    if (isAdminAuthenticated) setTuningMode('admin');
                    break;
                case 'wL0':
                    if (isAdminAuthenticated) setTuningMode('limited');
                    break;
                case 'wT0':
                    if (isAdminAuthenticated) setTuningMode('public');
                    else tuningAccess.release(tuningSessionKey);
                    break;
                case 'wT1':
                    if (isAdminAuthenticated) setTuningMode('limited');
                    else tuningAccess.acquire(tuningSessionKey);
                    break;
                default:
                    break;
'@
if ([regex]::Matches($text, $switchPattern).Count -ne 1) { throw 'No se encontro el switch de bloqueo esperado.' }
$text = [regex]::Replace($text, $switchPattern, $switchReplacement.TrimEnd(), 1)
$authPattern = "(?s)        const allowPortableLocalTuning = rtlVirtualMode && \(normalizedClientIp === '127\.0\.0\.1' \|\| normalizedClientIp === '::1'\);\s*        if \(allowPortableLocalTuning.*?\r?\n        \}"
$authReplacement = @'
        const allowPortableLocalTuning = rtlVirtualMode && (normalizedClientIp === '127.0.0.1' || normalizedClientIp === '::1');
        let commandAllowed = allowPortableLocalTuning || isAdminAuthenticated;

        if (!commandAllowed && command.startsWith('T')) {
            const access = tuningAccess.acquire(tuningSessionKey);
            commandAllowed = access.allowed;
            if (!commandAllowed) {
                try { ws.send(JSON.stringify({ type: 'tuning-access-denied', value: access })); } catch (_) {}
            }
        } else if (!commandAllowed) {
            commandAllowed = !serverConfig.lockToAdmin &&
                (serverConfig.publicTuner || isTuneAuthenticated);
        }

        if (commandAllowed) output.write(command + '\n');
'@
if ([regex]::Matches($text, $authPattern).Count -ne 1) { throw 'No se encontro el bloque de autorizacion portable.' }
$text = [regex]::Replace($text, $authPattern, $authReplacement.TrimEnd(), 1)
$closePattern = "(?s)\r?\n        if \(tunerLockTracker\.has\(ws\)\) \{.*?\r?\n        \}\r?\n\r?\n        if \(currentUsers === 0"
$closeReplacement = @'

        tuningAccess.release(tuningSessionKey);

        if (currentUsers === 0
'@
if ([regex]::Matches($text, $closePattern).Count -ne 1) { throw 'No se encontro la limpieza anterior de tunerLockTracker.' }
$text = [regex]::Replace($text, $closePattern, $closeReplacement, 1)
[IO.File]::WriteAllText($serverPath, $text, [Text.UTF8Encoding]::new($false))
$view = [IO.File]::ReadAllText($viewPath)
$setupView = [IO.File]::ReadAllText($setupPath)
$setupPattern = "(?m)^[^\r\n]*label: 'Admin lock'[^\r\n]*\r?$"
$setupMatch = [regex]::Match($setupView, $setupPattern)
if (-not $setupMatch.Success) { throw 'No se encontro Quick settings en setup.ejs.' }
$setupAnchor = $setupMatch.Value.TrimEnd([char]13, [char]10)
$setupControls = @"
$setupAnchor
                            <%- include('_components', {component: 'dropdown', cssClass: 'w-150', label: 'Acceso de sintonia', id: 'tuning-access-mode', inputId: 'tuningAccess-mode', placeholder: '', options: [{value: 'public', label: 'Siempre publico'}, {value: 'limited', label: 'Sesiones limitadas'}, {value: 'admin', label: 'Solo administrador'}]}) %>
                            <%- include('_components', {component: 'dropdown', cssClass: 'w-150', label: 'Usuarios simultaneos', id: 'tuning-access-users', inputId: 'tuningAccess-maxControllers', placeholder: '', options: [{value: 1, label: '1 usuario'}, {value: 2, label: '2 usuarios'}]}) %>
                            <%- include('_components', {component: 'dropdown', cssClass: 'w-150', label: 'Tiempo por sesion', id: 'tuning-access-minutes', inputId: 'tuningAccess-sessionMinutes', placeholder: '', options: [{value: 30, label: '30 minutos'}, {value: 60, label: '60 minutos'}]}) %><br>
"@.TrimEnd()
$setupView = $setupView.Remove($setupMatch.Index, $setupMatch.Length).Insert($setupMatch.Index, $setupControls)
$view = $view.Replace('Only people with tune password can tune.', 'Tuning access is limited by the administrator.')
$view = $view.Replace('Toggle password lock<br>Lasts until disconnect', 'Toggle limited sessions<br>30/60 minute maximum')
$view = $view.Replace('Toggle password lock<br>Lasts until restart', 'Toggle public or limited tuning')
[IO.File]::WriteAllText($setupPath, $setupView, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($viewPath, $view, [Text.UTF8Encoding]::new($false))
$mainJs = [IO.File]::ReadAllText($mainJsPath)
$parseAnchor = '    parsedData = JSON.parse(event.data);'
$deniedHandler = @'
    parsedData = JSON.parse(event.data);
    if (parsedData?.type === 'tuning-access-denied') {
        const access = parsedData.value || {};
        const message = access.reason === 'admin'
            ? 'El administrador ha bloqueado la sintonia.'
            : 'Ya hay ' + (access.active || access.maxControllers) + ' usuario(s) controlando. Intente cuando se libere un cupo.';
        sendToast('warning', 'Sintonia no disponible', message, false, false);
        return;
    }
'@
if (($mainJs.Split($parseAnchor).Count - 1) -lt 1) { throw 'No se encontro el parser WebSocket en main.js.' }
$index = $mainJs.IndexOf($parseAnchor)
$mainJs = $mainJs.Remove($index, $parseAnchor.Length).Insert($index, $deniedHandler.TrimEnd())
[IO.File]::WriteAllText($mainJsPath, $mainJs, [Text.UTF8Encoding]::new($false))
