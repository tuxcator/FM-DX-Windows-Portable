param(
    [switch]$Yes,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$expectedRemote = 'https://github.com/tuxcator/FM-DX-Windows-Portable.git'

function Invoke-Git {
    param([Parameter(Mandatory = $true)][string[]]$GitArguments)
    & git -C $root @GitArguments
    if ($LASTEXITCODE -ne 0) { throw "Git fallo: git $($GitArguments -join ' ')" }
}

Write-Host 'Actualizador desde GitHub - FM-DX Windows Portable' -ForegroundColor Cyan
Write-Host "Origen: $expectedRemote" -ForegroundColor DarkCyan
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git para Windows no esta instalado o no se encuentra en PATH.' }
if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) { throw 'Esta carpeta no es un clon Git. Use git clone --recurse-submodules.' }

$remote = (& git -C $root remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $remote -ne $expectedRemote) { throw "El remoto origin no coincide. Actual: $remote; esperado: $expectedRemote" }
$branch = (& git -C $root branch --show-current).Trim()
if ($branch -ne 'main') { throw "Cambie a la rama main antes de actualizar. Rama actual: $branch" }

$localChanges = @(& git -C $root status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'No se pudo revisar el estado del repositorio.' }
if ($localChanges.Count -gt 0) {
    Write-Host 'Cambios locales detectados:' -ForegroundColor Yellow
    $localChanges | ForEach-Object { Write-Host "  $_" }
    throw 'Actualizacion cancelada para no sobrescribir cambios locales. Confirme o respalde esos archivos primero.'
}

Write-Host 'Consultando origin/main...' -ForegroundColor Yellow
Invoke-Git -GitArguments @('fetch', '--prune', 'origin', 'main')
$counts = (& git -C $root rev-list --left-right --count 'HEAD...origin/main').Trim() -split '\s+'
if ($LASTEXITCODE -ne 0 -or $counts.Count -lt 2) { throw 'No se pudo comparar la copia local con origin/main.' }
$ahead = [int]$counts[0]
$behind = [int]$counts[1]
if ($ahead -gt 0) { throw "La copia local contiene $ahead commit(s) que no estan en GitHub. Publiquelos o reviselos antes de actualizar." }

if ($behind -gt 0) {
    Write-Host "Hay $behind commit(s) nuevo(s) disponibles." -ForegroundColor White
    if (-not $Yes) {
        $answer = Read-Host 'Desea descargar la actualizacion? (s/N)'
        if ($answer -notmatch '^[sSyY]$') { Write-Host 'Operacion cancelada; no se modifico ningun archivo.' -ForegroundColor Yellow; exit 0 }
    }
    Invoke-Git -GitArguments @('pull', '--ff-only', 'origin', 'main')
} else {
    Write-Host '[OK] El codigo principal ya esta actualizado.' -ForegroundColor Green
}

Write-Host 'Sincronizando dependencias fijadas...' -ForegroundColor Yellow
Invoke-Git -GitArguments @('submodule', 'sync', '--recursive')
Invoke-Git -GitArguments @('submodule', 'update', '--init', '--recursive')
if (-not $SkipTests) {
    Write-Host 'Ejecutando verificaciones...' -ForegroundColor Yellow
    & (Join-Path $root 'scripts\Test-GitHubReady.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Las verificaciones posteriores a la actualizacion fallaron.' }
}
$commit = (& git -C $root rev-parse --short HEAD).Trim()
Write-Host "[OK] Copia actualizada en $commit." -ForegroundColor Green
Write-Host 'Para generar el paquete nuevo, ejecute Construir.cmd.' -ForegroundColor Cyan