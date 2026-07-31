Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-ProjectRoot {
    return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
}

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Get-ProjectManifest {
    $root = Get-ProjectRoot
    return Get-Content -Raw -LiteralPath (Join-Path $root 'project.json') | ConvertFrom-Json
}

function Assert-WindowsX64 {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'Este ensamblador sólo puede ejecutarse en Windows.'
    }
    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'Se requiere Windows x64.'
    }
}

function Assert-PathInside([string]$Path, [string]$Parent) {
    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
    $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\')
    if (-not $fullPath.StartsWith($fullParent + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Ruta fuera del proyecto: $fullPath"
    }
    return $fullPath
}

function Reset-ProjectDirectory([string]$Path) {
    $root = Get-ProjectRoot
    $fullPath = Assert-PathInside $Path $root
    if (Test-Path -LiteralPath $fullPath) {
        Remove-Item -LiteralPath $fullPath -Recurse -Force
    }
    New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory = ''
    )

    $oldLocation = Get-Location
    try {
        if ($WorkingDirectory) { Set-Location -LiteralPath $WorkingDirectory }
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "El comando terminó con código $LASTEXITCODE`: $FilePath $($ArgumentList -join ' ')"
        }
    } finally {
        Set-Location $oldLocation
    }
}

function Save-JsonUtf8([object]$Value, [string]$Path, [int]$Depth = 12) {
    $json = $Value | ConvertTo-Json -Depth $Depth
    [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}

function Copy-DirectoryContents([string]$Source, [string]$Destination, [string[]]$ExcludeNames = @()) {
    if (-not (Test-Path -LiteralPath $Source)) { throw "No existe: $Source" }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | Where-Object { $ExcludeNames -notcontains $_.Name } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
}
