param()

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$configPath = Join-Path $root 'app\config.json'
$startScript = Join-Path $PSScriptRoot 'Start-FM-DX.ps1'
$passwordScript = Join-Path $PSScriptRoot 'Configure-RemotePasswords.ps1'
$toolsDir = Join-Path $root 'tools'
$cloudflared = Join-Path $toolsDir 'cloudflared.exe'

if (-not (Test-Path -LiteralPath $configPath)) { throw "No existe $configPath. Construya primero el paquete portable." }
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace([string]$config.password.adminPass) -or [string]::IsNullOrWhiteSpace([string]$config.password.tunePass)) {
    Write-Host 'Primero se abrirá la ventana para crear las dos contraseñas.' -ForegroundColor Cyan
    & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File $passwordScript
    if ($LASTEXITCODE -ne 0) { Write-Host 'Publicación cancelada.' -ForegroundColor Yellow; exit 1 }
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
}
$config.publicTuner = $false
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))

if (-not (Test-Path -LiteralPath $cloudflared)) {
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
    Write-Host 'Descargando cloudflared desde el repositorio oficial de Cloudflare...' -ForegroundColor Cyan
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $headers = @{ 'User-Agent' = 'FM-DX-Windows-Portable' }
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest' -Headers $headers
    $asset = $release.assets | Where-Object name -eq 'cloudflared-windows-amd64.exe' | Select-Object -First 1
    if (-not $asset) { throw 'No se encontró el ejecutable oficial cloudflared-windows-amd64.exe.' }
    $temporary = "$cloudflared.download"
    Invoke-WebRequest -Uri $asset.browser_download_url -Headers $headers -OutFile $temporary -UseBasicParsing
    if ($asset.digest -and $asset.digest -like 'sha256:*') {
        $expected = $asset.digest.Substring(7).ToLowerInvariant()
        $actual = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) { Remove-Item $temporary -Force; throw 'La firma SHA-256 de cloudflared no coincide.' }
    } else {
        $signature = Get-AuthenticodeSignature -LiteralPath $temporary
        if ($signature.Status -ne 'Valid') { Remove-Item $temporary -Force; throw 'No se pudo validar la firma de cloudflared.' }
    }
    Move-Item -LiteralPath $temporary -Destination $cloudflared -Force
}

$portableRoot = [IO.Path]::GetFullPath($root) + [IO.Path]::DirectorySeparatorChar
Get-Process node,python,airspyhf_hybrid,rtl_hybrid,redsea,ffmpeg -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.StartsWith($portableRoot, [StringComparison]::OrdinalIgnoreCase)
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 700
Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`"" -WindowStyle Minimized

$port = [int]$config.webserver.webserverPort
$ready = $false
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try { Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ready = $true; break }
    catch { Start-Sleep -Milliseconds 500 }
}
if (-not $ready) { throw "FM-DX no respondió en el puerto $port." }

Write-Host ''
Write-Host 'PUBLICACIÓN TEMPORAL A INTERNET' -ForegroundColor Green
Write-Host 'Busque abajo la dirección HTTPS terminada en trycloudflare.com.' -ForegroundColor Cyan
Write-Host 'En la web, pulse la llave y use la contraseña de sintonización para controlar el radio.' -ForegroundColor Yellow
Write-Host 'Mantenga esta ventana abierta. Ctrl+C retira el acceso exterior.' -ForegroundColor DarkGray
Write-Host ''
& $cloudflared tunnel --url "http://127.0.0.1:$port" --no-autoupdate
exit $LASTEXITCODE