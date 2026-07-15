# Zip the electron-builder portable exe in dist/ into a versioned release zip.
# Shared by local `pnpm dist:zip` and CI (.github/workflows/release.yml).
# ASCII-only on purpose: Windows PowerShell 5.1 misreads BOM-less UTF-8 sources.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$exe = Get-ChildItem (Join-Path $root 'dist') -Filter '*Portable*.exe' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if ($null -eq $exe) {
  throw 'No portable exe found in dist/. Run `pnpm dist:portable` first.'
}

$zip = Join-Path $root ("dist\NoitaSaveEditor-Portable-{0}-win-x64.zip" -f $version)
Compress-Archive -Path $exe.FullName -DestinationPath $zip -Force
Write-Output $zip
