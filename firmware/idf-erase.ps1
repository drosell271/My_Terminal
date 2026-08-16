param(
    [Parameter(Mandatory = $true)]
    [string]$Port
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$IdfPath = "C:\esp\v6.0\esp-idf"
$UvPythonBin = "C:\Users\drmor\.local\bin"

if (-not (Test-Path "$IdfPath\export.ps1")) {
    throw "No se encuentra ESP-IDF en $IdfPath"
}

$env:Path = "$UvPythonBin;$env:Path"
. "$IdfPath\export.ps1"
Set-Location $ProjectRoot
idf.py -p $Port erase-flash
