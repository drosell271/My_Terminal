param(
    [string]$Version
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "idf-env.ps1")

if ($Version) {
    Set-Content -Path (Join-Path $PSScriptRoot "version.txt") -Value $Version -NoNewline
    Write-Host "Configurada version de firmware en version.txt: $Version"
}

idf.py build

