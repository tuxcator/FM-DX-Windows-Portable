param([switch]$SkipProjectTests)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$failures = [System.Collections.Generic.List[string]]::new()

function Fail([string]$Message) { $script:failures.Add($Message) }
function Check([bool]$Condition, [string]$Message) { if (-not $Condition) { Fail $Message } }

Write-Host 'Verificando preparacion para GitHub...' -ForegroundColor Cyan

foreach ($relative in @('.gitignore', '.gitattributes', '.gitmodules', 'project.json', 'README.md', 'THIRD_PARTY_NOTICES.md', '.github\workflows\windows-portable.yml', '.github\dependabot.yml', 'docs\MANUAL_COMPLETO.md')) {
    Check (Test-Path -LiteralPath (Join-Path $root $relative)) "Falta $relative"
}

try {
    $config = Get-Content -Raw -LiteralPath (Join-Path $root 'config\config.json') | ConvertFrom-Json
    Check ([string]::IsNullOrEmpty([string]$config.password.adminPass)) 'La plantilla contiene adminPass; elimine el secreto.'
    Check ([string]::IsNullOrEmpty([string]$config.password.tunePass)) 'La plantilla contiene tunePass; elimine el secreto.'
} catch { Fail "config/config.json no es JSON valido: $($_.Exception.Message)" }

$ignore = Get-Content -Raw -LiteralPath (Join-Path $root '.gitignore')
foreach ($pattern in @('dist/', 'runtime/', '.cache/', 'backups/', 'node_modules/', '.env')) {
    Check ($ignore.Contains($pattern)) ".gitignore no protege $pattern"
}

$tracked = @(& git -C $root ls-files)
if ($LASTEXITCODE -ne 0) { Fail 'git ls-files fallo.' }
foreach ($relative in $tracked) {
    $path = Join-Path $root $relative
    if ((Test-Path -LiteralPath $path -PathType Leaf) -and (Get-Item -LiteralPath $path).Length -gt 95MB) {
        Fail "Archivo versionado mayor de 95 MiB: $relative"
    }
}

$manifest = Get-Content -Raw -LiteralPath (Join-Path $root 'project.json') | ConvertFrom-Json
$submodules = @{
    airspyhf='third_party\airspyhf'; 'fm-dx-webserver'='third_party\fm-dx-webserver';
    NRSC5_HDRadio='third_party\NRSC5_HDRadio'; nrsc5='third_party\nrsc5';
    'nrsc5-gui'='third_party\nrsc5-gui'; redsea='third_party\redsea'; 'liquid-dsp'='third_party\liquid-dsp'
}
foreach ($name in $submodules.Keys) {
    $path = Join-Path $root $submodules[$name]
    Check (Test-Path -LiteralPath $path) "Falta submodulo $name"
    if (Test-Path -LiteralPath $path) {
        $actual = (& git -C $path rev-parse HEAD 2>$null).Trim()
        Check ($LASTEXITCODE -eq 0) "No se pudo leer el commit de $name"
        Check ($actual -eq [string]$manifest.upstream.$name) "Commit de $name no coincide con project.json"
    }
}

& git -C $root diff --check
Check ($LASTEXITCODE -eq 0) 'git diff --check encontro errores.'

if (-not $SkipProjectTests) {
    & (Join-Path $root 'tests\Test-Project.ps1')
    Check ($LASTEXITCODE -eq 0) 'Las pruebas del proyecto fallaron.'
}

if ($failures.Count) {
    Write-Host ''
    $failures | ForEach-Object { Write-Host "[ERROR] $_" -ForegroundColor Red }
    throw "$($failures.Count) comprobacion(es) fallaron."
}
Write-Host '[OK] Repositorio preparado para GitHub; no se detectaron secretos en las plantillas ni archivos grandes versionados.' -ForegroundColor Green