param([switch]$Force)

# Compatibility entry point. The actual implementation compiles the pinned
# source revision because MSYS2 does not publish an nrsc5 binary package.
& (Join-Path $PSScriptRoot 'Build-Nrsc5.ps1') -Force:$Force
exit $LASTEXITCODE
