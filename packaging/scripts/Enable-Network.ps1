param()

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$configPath = Join-Path $root 'app\config.json'
$nodePath = Join-Path $root 'runtime\node\node.exe'
$passwordScript = Join-Path $PSScriptRoot 'Configure-RemotePasswords.ps1'
$ruleName = 'FM-DX Windows Portable - Red local'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Solicitando permiso de administrador para configurar el Firewall de Windows...' -ForegroundColor Yellow
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $process = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    exit $process.ExitCode
}

if (-not (Test-Path -LiteralPath $configPath)) { throw "No existe $configPath. Construya primero el paquete portable." }
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace([string]$config.password.adminPass) -or [string]::IsNullOrWhiteSpace([string]$config.password.tunePass)) {
    Write-Host 'Primero se abrirá la ventana para crear las dos contraseñas.' -ForegroundColor Cyan
    & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File $passwordScript
    if ($LASTEXITCODE -ne 0) { Write-Host 'Configuración cancelada; no se modificó el Firewall.' -ForegroundColor Yellow; exit 1 }
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
}
$config.webserver.webserverIp = '0.0.0.0'
$config.publicTuner = $false
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))

Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $ruleName -Description 'Acceso a FM-DX solamente desde la subred local privada.' `
    -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP `
    -LocalPort ([string]$config.webserver.webserverPort) -Program $nodePath -RemoteAddress LocalSubnet | Out-Null

$addresses = [Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName()) | Where-Object {
    $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and -not [Net.IPAddress]::IsLoopback($_)
} | ForEach-Object IPAddressToString | Select-Object -Unique
Write-Host ''
Write-Host 'Acceso por red local habilitado correctamente.' -ForegroundColor Green
foreach ($address in $addresses) { Write-Host "  http://$address`:$($config.webserver.webserverPort)" -ForegroundColor Cyan }
Write-Host ''
Write-Host 'IMPORTANTE:' -ForegroundColor Yellow
Write-Host '1. Reinicie FM-DX.'
Write-Host '2. En la página web pulse el icono de llave.'
Write-Host '3. Use la contraseña de sintonización para controlar el radio.'
Write-Host '4. Use la contraseña de administrador para abrir Configuración/Setup.'