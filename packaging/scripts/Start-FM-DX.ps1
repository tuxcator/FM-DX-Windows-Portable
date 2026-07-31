$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$app = Join-Path $root 'app'
$node = Join-Path $root 'runtime\node\node.exe'
$python = Join-Path $root 'runtime\python\python.exe'

function Stop-PortableOrphans {
    $portableRoot = [System.IO.Path]::GetFullPath($root) + [System.IO.Path]::DirectorySeparatorChar
    $names = @('node', 'python', 'airspyhf_hybrid', 'rtl_hybrid', 'redsea', 'ffmpeg')
    $orphans = Get-Process -Name $names -ErrorAction SilentlyContinue | Where-Object {
        $_.Id -ne $PID -and $_.Path -and $_.Path.StartsWith($portableRoot, [System.StringComparison]::OrdinalIgnoreCase)
    }
    if ($orphans) {
        Write-Host "Cerrando $($orphans.Count) proceso(s) anterior(es) de FM-DX..." -ForegroundColor Yellow
        $orphans | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
}

foreach ($required in @($node, $python, (Join-Path $app 'index.js'), (Join-Path $app 'config.json'))) {
    if (-not (Test-Path -LiteralPath $required)) {
        Write-Host "Falta un archivo requerido: $required" -ForegroundColor Red
        exit 1
    }
}

$hardware = & (Join-Path $PSScriptRoot 'Detect-Hardware.ps1') -Root $root -Quiet
$config = Get-Content -Raw -LiteralPath (Join-Path $app 'config.json') | ConvertFrom-Json
$port = [int]$config.webserver.webserverPort
$url = "http://localhost:$port"

# Prevent two launches from racing for the same HTTP port. A second click waits
# for the first instance and opens its existing web interface instead.
$instanceMutex = [System.Threading.Mutex]::new($false, 'Local\FM-DX-Windows-Portable')
$ownsInstanceMutex = $false
try { $ownsInstanceMutex = $instanceMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $ownsInstanceMutex = $true }

if (-not $ownsInstanceMutex) {
    Write-Host 'FM-DX ya se esta iniciando. Esperando la interfaz existente...' -ForegroundColor Yellow
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $existingListener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($existingListener) {
            Start-Process $url
            exit 0
        }
        Start-Sleep -Milliseconds 500
    }
    Write-Host 'Otra instancia conserva el bloqueo, pero el servidor no respondio.' -ForegroundColor Red
    exit 1
}

$portListener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($portListener) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($portListener.OwningProcess)" -ErrorAction SilentlyContinue
    $isOwnServer = $owner -and $owner.ExecutablePath -and ([System.IO.Path]::GetFullPath($owner.ExecutablePath) -eq [System.IO.Path]::GetFullPath($node))
    if ($isOwnServer) {
        Write-Host "FM-DX ya esta ejecutandose (PID $($owner.ProcessId)). Abriendo $url" -ForegroundColor Green
        Start-Process $url
        exit 0
    }
    $ownerDescription = if ($owner) { "$($owner.Name), PID $($owner.ProcessId)" } else { "PID $($portListener.OwningProcess)" }
    Write-Host "No se puede iniciar: el puerto $port esta ocupado por $ownerDescription." -ForegroundColor Red
    Write-Host 'Cierre ese programa o cambie webserverPort en app\config.json.' -ForegroundColor Yellow
    exit 1
}
# The port is free and this launcher owns the mutex: any remaining package
# processes are stale children from an interrupted console and are safe to close.
Stop-PortableOrphans

$pluginBin = Join-Path $app 'plugins\NRSC5_HDRadio'
$env:PATH = (Join-Path $root 'runtime\node') + ';' + (Join-Path $root 'runtime\python') + ';' + $pluginBin + ';' + $env:PATH
$env:PYTHONUTF8 = '1'
$env:PYTHONUNBUFFERED = '1'

Write-Host 'FM-DX Windows Portable' -ForegroundColor Cyan
Write-Host "Sintonizador: $(switch ($hardware.Selected) { 'airspyhf' { 'Airspy HF+ / NRSC-5' }; 'rtl' { 'RTL-SDR / NRSC-5' }; default { 'TEF668x / XDR' } })"
if ($hardware.Selected -eq 'rtl' -and -not $hardware.RtlAccessible) {
    Write-Host 'El RTL-SDR esta conectado pero ocupado. Cierre SDR# antes de sintonizar.' -ForegroundColor Yellow
}
Write-Host "Interfaz: $url"
Write-Host 'Presione Ctrl+C para detener el servidor.' -ForegroundColor DarkGray

$browserJob = Start-Job -ScriptBlock {
    param($targetUrl)
    Start-Sleep -Seconds 4
    Start-Process $targetUrl
} -ArgumentList $url

Push-Location -LiteralPath $app
try {
    & $node 'index.js'
    exit $LASTEXITCODE
} finally {
    Pop-Location
    Stop-Job -Job $browserJob -ErrorAction SilentlyContinue
    Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
    Stop-PortableOrphans
    if ($ownsInstanceMutex) { $instanceMutex.ReleaseMutex() }
    $instanceMutex.Dispose()
}
