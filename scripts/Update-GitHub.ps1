param(
    [string]$Message = '',
    [switch]$Yes,
    [switch]$SkipTests,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$expectedRemote = 'https://github.com/tuxcator/FM-DX-Windows-Portable.git'
$repoName = 'tuxcator/FM-DX-Windows-Portable'

function Invoke-Git {
    param([Parameter(Mandatory = $true)][string[]]$GitArguments)
    & git -C $root @GitArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Git fallo: git $($GitArguments -join ' ')"
    }
}

Write-Host 'Actualizador de FM-DX Windows Portable' -ForegroundColor Cyan
Write-Host "Destino: https://github.com/$repoName" -ForegroundColor DarkCyan

if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
    throw "No se encontro el repositorio Git en $root"
}

$remote = (& git -C $root remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $remote -ne $expectedRemote) {
    throw "El remoto origin no coincide. Actual: $remote; esperado: $expectedRemote"
}

$ghCommand = Get-Command gh -ErrorAction SilentlyContinue
if ($ghCommand) {
    $ghPath = $ghCommand.Source
} else {
    $ghPath = 'C:\Program Files\GitHub CLI\gh.exe'
    if (-not (Test-Path -LiteralPath $ghPath)) {
        throw 'GitHub CLI no esta instalado. Ejecute: winget install --id GitHub.cli --exact'
    }
}

& $ghPath auth status
if ($LASTEXITCODE -ne 0) {
    throw 'No hay sesion de GitHub. Ejecute: gh auth login --web --git-protocol https'
}

$authenticatedRepo = (& $ghPath repo view $repoName --json nameWithOwner --jq '.nameWithOwner').Trim()
if ($LASTEXITCODE -ne 0 -or $authenticatedRepo -ne $repoName) {
    throw "No se pudo acceder a $repoName con la cuenta autenticada."
}

$branch = (& git -C $root branch --show-current).Trim()
if ($branch -ne 'main') {
    throw "Este actualizador solo publica main. Rama actual: $branch"
}

Write-Host ''
Write-Host 'Comprobando si GitHub tiene cambios mas nuevos...' -ForegroundColor Yellow
Invoke-Git -GitArguments @('fetch', 'origin', 'main')
$counts = (& git -C $root rev-list --left-right --count 'HEAD...origin/main').Trim() -split '\s+'
if ($LASTEXITCODE -ne 0 -or $counts.Count -lt 2) {
    throw 'No se pudo comparar main con origin/main.'
}
$behind = [int]$counts[1]
if ($behind -gt 0) {
    throw "La copia local esta $behind commit(s) atras de GitHub. Actualice o resuelva los cambios antes de publicar."
}

Write-Host ''
Write-Host 'Ejecutando verificaciones...' -ForegroundColor Yellow
$preflight = Join-Path $root 'scripts\Test-GitHubReady.ps1'
if ($SkipTests) {
    & $preflight -SkipProjectTests
} else {
    & $preflight
}
if ($LASTEXITCODE -ne 0) {
    throw 'Las verificaciones fallaron; no se publicara nada.'
}

$changes = @(& git -C $root status --short)
if ($changes.Count -eq 0) {
    Write-Host '[OK] No hay cambios pendientes; GitHub ya esta actualizado.' -ForegroundColor Green
    exit 0
}

Write-Host ''
Write-Host 'Cambios que se prepararan:' -ForegroundColor White
$changes | ForEach-Object { Write-Host "  $_" }

if ($DryRun) {
    Write-Host '[OK] Simulacion terminada; no se preparo, confirmo ni publico ningun archivo.' -ForegroundColor Green
    exit 0
}

if (-not $Yes) {
    $answer = Read-Host 'Desea validar, confirmar y publicar estos cambios? (s/N)'
    if ($answer -notmatch '^[sSyY]$') {
        Write-Host 'Operacion cancelada; no se modifico el indice Git.' -ForegroundColor Yellow
        exit 0
    }
}

Invoke-Git -GitArguments @('add', '-A')

$staged = @(& git -C $root diff --cached --name-only --diff-filter=ACMR)
if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo leer la lista de archivos preparados.'
}
if ($staged.Count -eq 0) {
    Write-Host '[OK] No hay cambios versionables despues de aplicar .gitignore.' -ForegroundColor Green
    exit 0
}

$forbiddenPatterns = @(
    '^(dist|runtime|\.cache|backups|node_modules)/',
    '(^|/)\.env($|\.)',
    '\.(pem|key|pfx|p12)$',
    '(^|/)secrets\.'
)
$forbidden = @($staged | Where-Object {
    $path = $_
    $forbiddenPatterns | Where-Object { $path -match $_ }
})
if ($forbidden.Count -gt 0) {
    & git -C $root reset -- $forbidden
    throw "Se bloquearon archivos privados o generados: $($forbidden -join ', ')"
}

& git -C $root diff --cached --check
if ($LASTEXITCODE -ne 0) {
    throw 'git diff --cached --check encontro errores; no se creo el commit.'
}

if ([string]::IsNullOrWhiteSpace($Message)) {
    $Message = Read-Host 'Mensaje del commit [Fix TEF668X DirectShow audio stability]'
}
if ([string]::IsNullOrWhiteSpace($Message)) {
    $Message = 'Fix TEF668X DirectShow audio stability'
}
if ($Message.Length -gt 100) {
    throw 'El mensaje del commit debe tener 100 caracteres o menos.'
}

Write-Host ''
Write-Host "Creando commit: $Message" -ForegroundColor Yellow
Invoke-Git -GitArguments @('commit', '-m', $Message)

Write-Host ''
Write-Host 'Subiendo main sin force push...' -ForegroundColor Yellow
Invoke-Git -GitArguments @('push', 'origin', 'main')

$commit = (& git -C $root rev-parse --short HEAD).Trim()
Write-Host ''
Write-Host "[OK] GitHub actualizado en el commit $commit." -ForegroundColor Green
Write-Host "Repositorio: https://github.com/$repoName"
Write-Host "Acciones:    https://github.com/$repoName/actions"

& $ghPath run list --repo $repoName --limit 3
