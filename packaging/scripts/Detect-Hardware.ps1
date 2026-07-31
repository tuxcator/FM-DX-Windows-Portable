param(
    [string]$Root = '',
    [switch]$Quiet,
    [switch]$NoWrite
)

$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) }
$app = Join-Path $Root 'app'
$mainPath = Join-Path $app 'config.json'
$hdPath = Join-Path $app 'plugins_configs\NRSC5_HDRadio.json'
$plugin = Join-Path $app 'plugins\NRSC5_HDRadio'

function Save-Json([object]$Value, [string]$Path) {
    $json = $Value | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}

function Invoke-Probe([string]$Executable, [string]$Kind) {
    if (-not (Test-Path -LiteralPath $Executable)) {
        return [pscustomobject]@{ Present = $false; Accessible = $false; Output = "$Kind probe ausente" }
    }
    try {
        $si = [System.Diagnostics.ProcessStartInfo]::new()
        $si.FileName = $Executable
        $si.UseShellExecute = $false
        $si.CreateNoWindow = $true
        $si.RedirectStandardOutput = $true
        $si.RedirectStandardError = $true
        $process = [System.Diagnostics.Process]::Start($si)
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        $output = ($stdout + [Environment]::NewLine + $stderr).Trim()
        if ($Kind -eq 'airspyhf') {
            $present = $output -match 'S/N:|Serial Number:|Part ID:|Firmware Version:'
            $accessible = $present -and $output -match 'Firmware Version:|Available sample rate'
        } else {
            $present = $output -match 'Found\s+[1-9]\d*\s+device'
            $accessible = $output -match 'Current configuration:' -and $output -notmatch 'Failed to open rtlsdr device|usb_open error'
        }
        return [pscustomobject]@{ Present = $present; Accessible = $accessible; Output = $output }
    } catch {
        return [pscustomobject]@{ Present = $false; Accessible = $false; Output = $_.Exception.Message }
    }
}

if (-not (Test-Path -LiteralPath $mainPath)) { throw "No se encontro $mainPath" }
$main = Get-Content -Raw -LiteralPath $mainPath | ConvertFrom-Json
$hd = Get-Content -Raw -LiteralPath $hdPath | ConvertFrom-Json
if (-not $main.PSObject.Properties['portableHardware']) {
    $main | Add-Member -NotePropertyName portableHardware -NotePropertyValue ([pscustomobject]@{})
}
$mode = [string]$main.portableHardware.mode
if ($mode -notin @('auto', 'airspyhf', 'rtl', 'tef')) { $mode = 'auto' }
$airspy = Invoke-Probe (Join-Path $plugin 'airspyhf_info.exe') 'airspyhf'
$rtl = Invoke-Probe (Join-Path $plugin 'rtl_eeprom.exe') 'rtl'

$selected = switch ($mode) {
    'airspyhf' { 'airspyhf' }
    'rtl' { 'rtl' }
    'tef' { 'tef' }
    default { if ($airspy.Present) { 'airspyhf' } elseif ($rtl.Present) { 'rtl' } else { 'tef' } }
}

if ($selected -in @('airspyhf', 'rtl')) {
    $main.device = 'sdr'
    if (-not $main.PSObject.Properties['portableRtlMode']) { $main | Add-Member -NotePropertyName portableRtlMode -NotePropertyValue $true }
    else { $main.portableRtlMode = $true }
    $hd.autoStart = $true
    if (-not $hd.PSObject.Properties['receiver']) { $hd | Add-Member -NotePropertyName receiver -NotePropertyValue $selected }
    else { $hd.receiver = $selected }
} else {
    $main.device = 'tef'
    if (-not $main.PSObject.Properties['portableRtlMode']) { $main | Add-Member -NotePropertyName portableRtlMode -NotePropertyValue $false }
    else { $main.portableRtlMode = $false }
    $hd.autoStart = $false
}
foreach ($entry in @{
    mode=$mode; detected=$selected; airspyPresent=[bool]$airspy.Present;
    airspyAccessible=[bool]$airspy.Accessible; rtlPresent=[bool]$rtl.Present;
    rtlAccessible=[bool]$rtl.Accessible
}.GetEnumerator()) {
    if ($main.portableHardware.PSObject.Properties[$entry.Key]) { $main.portableHardware.($entry.Key) = $entry.Value }
    else { $main.portableHardware | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value }
}

if (-not $NoWrite) { Save-Json $main $mainPath; Save-Json $hd $hdPath }
if (-not $Quiet) {
    Write-Host "Modo configurado: $mode"
    Write-Host "Sintonizador seleccionado: $(switch ($selected) { 'airspyhf' {'Airspy HF+'}; 'rtl' {'RTL-SDR'}; default {'TEF668x / XDR'} })"
    if ($airspy.Present -and $airspy.Accessible) { Write-Host '[OK] Airspy HF+ detectado y disponible.' -ForegroundColor Green }
    elseif ($airspy.Present) { Write-Host '[WARN] Airspy HF+ detectado pero ocupado o inaccesible.' -ForegroundColor Yellow }
    if ($rtl.Present -and $rtl.Accessible) { Write-Host '[OK] RTL-SDR disponible como respaldo.' -ForegroundColor Green }
}
[pscustomobject]@{
    Mode=$mode; Selected=$selected;
    AirspyPresent=$airspy.Present; AirspyAccessible=$airspy.Accessible; AirspyOutput=$airspy.Output;
    RtlPresent=$rtl.Present; RtlAccessible=$rtl.Accessible; RtlOutput=$rtl.Output
}