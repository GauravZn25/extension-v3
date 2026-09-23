# Developer    : Gaurav Jain
# Created Date : 01-Sep-2026
# Purpose      : Build the Chrome Web Store upload zip from a clean allowlist.
#
# Allowlist, not ignore-list, on purpose: zipping the folder minus a few
# exclusions is how backend source, internal docs and supporter email addresses
# end up shipped to every installer. Anything not named here does not ship.
#
# Usage:
#   .\build.ps1              -> dist\reddit-picture-gallery-downloader.zip
#   .\build.ps1 -KeepStage   -> also leaves dist\package\ for "Load unpacked"
#
# -KeepStage exists so the folder you test is byte-for-byte the folder you
# upload. Loading the repo root unpacked tests something slightly different
# from what users get.

param([switch]$KeepStage)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'package'
$zip = Join-Path $dist 'reddit-picture-gallery-downloader.zip'

# Every file the extension actually loads at runtime.
$files = @(
    'manifest.json',
    'background.js',
    'content.js',
    'license.js',
    'themes.js',
    'license-ui.js',
    'popup.html', 'popup.js',
    'options.html', 'options.js', 'options.css',
    'welcome.html', 'welcome.js',
    'transparency.html', 'transparency.js',
    'privacy.html',
    'tips.html',
    'fonts.css',
    'jszip.min.js',
    'Sortable.min.js',
    'icon16.png', 'icon48.png', 'icon128.png',
    # Demo assets for the options page's mock-post preview.
    'user_dummy.jpg', 'peacock.jpg', 'peacock2.jpg', 'peacock3.jpg'
)

$folders = @('fonts')

if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$missing = @()
foreach ($f in $files) {
    $src = Join-Path $root $f
    if (Test-Path $src) { Copy-Item $src -Destination $stage }
    else { $missing += $f }
}
foreach ($d in $folders) {
    $src = Join-Path $root $d
    if (Test-Path $src) { Copy-Item $src -Destination $stage -Recurse }
    else { $missing += "$d/" }
}

# A missing runtime file must not produce an uploadable zip - a store package
# that loads without one of its own scripts is worse than no package.
if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "BUILD FAILED - these files are in the allowlist but not on disk:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "Either restore them or remove them from the allowlist in build.ps1." -ForegroundColor Red
    exit 1
}

# A literal REPLACE_ token reaching the store is the single most expensive
# mistake available here, so fail the build rather than warn about it.
$scanPaths = @(
    (Join-Path $stage '*.js'),
    (Join-Path $stage '*.json'),
    (Join-Path $stage '*.html')
)
$pattern = 'REPLACE_WITH_|REPLACE-WITH-|REPLACE_ME_|<WORKER_DOMAIN>|<GIVEDO_|<PAYMENT_LINK|<STRIPE_'
$placeholders = Select-String -Path $scanPaths -Pattern $pattern -ErrorAction SilentlyContinue
if ($placeholders) {
    Write-Host ""
    Write-Host "BUILD FAILED - unreplaced placeholders in the package:" -ForegroundColor Red
    $placeholders | ForEach-Object { Write-Host ("  {0}:{1}  {2}" -f $_.Filename, $_.LineNumber, $_.Line.Trim()) -ForegroundColor Red }
    Write-Host ""
    Write-Host "Fill these in (SETUP.md section 3) and re-run." -ForegroundColor Red
    exit 1
}

# Entry names are written by hand, one file at a time, because on Windows
# PowerShell 5.1 (.NET Framework) BOTH Compress-Archive and
# ZipFile::CreateFromDirectory emit native separators - fonts/ ships as
# "fonts\Caveat.ttf". That violates ZIP APPNOTE 4.4.17.1, and Chromium's
# unpacker rejects backslashes outright, so the fonts never land at fonts/ and
# every page silently falls back to system type. CreateEntryFromFile lets us
# name each entry ourselves, which is the only reliable fix on this runtime.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stageRoot = (Resolve-Path $stage).Path.TrimEnd('\')
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem -Path $stageRoot -Recurse -File | ForEach-Object {
        $entryName = $_.FullName.Substring($stageRoot.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $_.FullName, $entryName,
            [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }

# Assert rather than trust - this one is invisible until a user reports "the
# fonts look wrong", long after the listing went live.
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
    $bad = @($archive.Entries | Where-Object { $_.FullName -like '*\*' })
    $entryCount = $archive.Entries.Count
} finally { $archive.Dispose() }

if ($bad.Count -gt 0) {
    Write-Host ""
    Write-Host "BUILD FAILED - backslashes in zip entry names:" -ForegroundColor Red
    $bad | ForEach-Object { Write-Host "  $($_.FullName)" -ForegroundColor Red }
    Remove-Item -Force $zip
    exit 1
}

if (-not $KeepStage) { Remove-Item -Recurse -Force $stage }

$sizeText = "{0} MB" -f [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host ""
Write-Host "Built $zip ($sizeText, $entryCount entries)" -ForegroundColor Green
Write-Host "Upload that file at https://chrome.google.com/webstore/devconsole" -ForegroundColor Green
if ($KeepStage) {
    Write-Host ""
    Write-Host "Load unpacked from: $stage" -ForegroundColor Cyan
    Write-Host "(exactly what is inside the zip - nothing else)" -ForegroundColor Cyan
}
