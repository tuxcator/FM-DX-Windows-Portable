param(
    [switch]$IncludeMsys2,
    [switch]$Force
)

. (Join-Path $PSScriptRoot 'lib\Common.ps1')
Assert-WindowsX64

$root = Get-ProjectRoot
$manifest = Get-ProjectManifest
$cache = Join-Path $root '.cache\downloads'
$runtime = Join-Path $root 'runtime'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
New-Item -ItemType Directory -Path $runtime -Force | Out-Null

function Get-Download([string]$Url, [string]$FileName) {
    $destination = Join-Path $cache $FileName
    if ($Force -or -not (Test-Path -LiteralPath $destination)) {
        Write-Step "Descargando $FileName"
        Invoke-WebRequest -Uri $Url -OutFile $destination -UseBasicParsing
    } else {
        Write-Ok "Descarga en caché: $FileName"
    }
    return $destination
}

$nodeVersion = $manifest.runtimes.node.version
$nodeZip = Get-Download $manifest.runtimes.node.url "node-v$nodeVersion-win-x64.zip"
$nodeDir = Join-Path $runtime 'node'
if ($Force -or -not (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe'))) {
    Write-Step "Extrayendo Node.js $nodeVersion"
    $nodeTemp = Join-Path $root '.cache\node-extract'
    Reset-ProjectDirectory $nodeTemp
    Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeTemp -Force
    Reset-ProjectDirectory $nodeDir
    $nodeSource = Get-ChildItem -LiteralPath $nodeTemp -Directory | Select-Object -First 1
    Copy-DirectoryContents $nodeSource.FullName $nodeDir
}
Write-Ok "Node.js portátil: $nodeDir"

$pythonVersion = $manifest.runtimes.python.version
$pythonZip = Get-Download $manifest.runtimes.python.url "python-$pythonVersion-embed-amd64.zip"
$pythonDir = Join-Path $runtime 'python'
if ($Force -or -not (Test-Path -LiteralPath (Join-Path $pythonDir 'python.exe'))) {
    Write-Step "Extrayendo Python $pythonVersion"
    Reset-ProjectDirectory $pythonDir
    Expand-Archive -LiteralPath $pythonZip -DestinationPath $pythonDir -Force
}
Write-Ok "Python portátil: $pythonDir"

if ($IncludeMsys2) {
    $msysVersion = $manifest.runtimes.msys2.version
    $msysArchive = Get-Download $manifest.runtimes.msys2.url "msys2-base-x86_64-$msysVersion.sfx.exe"
    $msysParent = Join-Path $root '.cache\msys2'
    $bash = Join-Path $msysParent 'msys64\usr\bin\bash.exe'
    if ($Force -or -not (Test-Path -LiteralPath $bash)) {
        Write-Step "Extrayendo MSYS2 $msysVersion sin instalarlo en Windows"
        Reset-ProjectDirectory $msysParent
        $process = Start-Process -FilePath $msysArchive -ArgumentList @('-y', "-o$msysParent") -Wait -PassThru -NoNewWindow
        if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $bash)) {
            throw "No se pudo extraer MSYS2 (código $($process.ExitCode))."
        }
    }
    Write-Ok "MSYS2 autocontenido: $msysParent"
}

$downloadFiles = Get-ChildItem -LiteralPath $cache -File | ForEach-Object {
    [ordered]@{ file = $_.Name; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
}
$runtimeManifest = [ordered]@{
    generatedAt = [DateTime]::UtcNow.ToString('o')
    node = $nodeVersion
    python = $pythonVersion
    downloads = @($downloadFiles)
}
Save-JsonUtf8 $runtimeManifest (Join-Path $runtime 'manifest.json')
