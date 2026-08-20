param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "idf-env.ps1")
idf.py build
