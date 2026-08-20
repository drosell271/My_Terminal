$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$UvPythonBin = "C:\Users\drmor\.local\bin"
$PreferredIdfPath = "C:\esp\v5.4.4\esp-idf"

function Get-InstalledIdfPath {
    if ($env:MY_TERMINAL_IDF_PATH -and (Test-Path (Join-Path $env:MY_TERMINAL_IDF_PATH "export.ps1"))) {
        return $env:MY_TERMINAL_IDF_PATH
    }

    if (Test-Path (Join-Path $PreferredIdfPath "export.ps1")) {
        return $PreferredIdfPath
    }

    if ($env:IDF_PATH -and (Test-Path (Join-Path $env:IDF_PATH "export.ps1"))) {
        return $env:IDF_PATH
    }

    $espRoot = "C:\esp"
    if (-not (Test-Path $espRoot)) {
        return $null
    }

    $candidates = Get-ChildItem -Path $espRoot -Directory |
        ForEach-Object {
            $idfPath = Join-Path $_.FullName "esp-idf"
            if (Test-Path (Join-Path $idfPath "export.ps1")) {
                [pscustomobject]@{
                    Path = $idfPath
                    Version = try { [version]($_.Name -replace "^v", "") } catch { [version]"0.0.0" }
                }
            }
        } |
        Sort-Object -Property Version -Descending

    if ($candidates) {
        return $candidates[0].Path
    }

    return $null
}

$IdfPath = Get-InstalledIdfPath
if (-not $IdfPath) {
    throw "No se encuentra ESP-IDF. Instala ESP-IDF en C:\esp\v5.4.4\esp-idf o define MY_TERMINAL_IDF_PATH"
}

if (Test-Path $UvPythonBin) {
    $env:Path = "$UvPythonBin;$env:Path"
}

. (Join-Path $IdfPath "export.ps1")
Set-Location $ProjectRoot
