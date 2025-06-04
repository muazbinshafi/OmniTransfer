# OmniTransfer Windows Installer
# Run as Administrator: Set-ExecutionPolicy Bypass -Scope Process -Force; .\install.ps1

$ErrorActionPreference = "Stop"
$Version = "latest"
$RepoOwner = "muazbinshafi"
$RepoName = "OmniTransfer"
$AppName = "OmniTransfer"

Write-Host ""
Write-Host "  OmniTransfer — Windows Installer" -ForegroundColor Cyan
Write-Host "  Developed by MuazBinShafi" -ForegroundColor DarkCyan
Write-Host ""

# Detect architecture
$Arch = if ([System.Environment]::Is64BitOperatingSystem) { "x86_64" } else { "i686" }
Write-Host "  Architecture: $Arch" -ForegroundColor Gray

# Fetch latest release
Write-Host "  Fetching latest release from GitHub..." -ForegroundColor White
$ApiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
try {
    $Release = Invoke-RestMethod -Uri $ApiUrl -Headers @{ "User-Agent" = "OmniTransfer-Installer" }
    $Version = $Release.tag_name
} catch {
    Write-Host "  Could not fetch release info. Please download manually from:" -ForegroundColor Yellow
    Write-Host "  https://github.com/$RepoOwner/$RepoName/releases" -ForegroundColor Cyan
    exit 1
}

Write-Host "  Latest version: $Version" -ForegroundColor Green

# Find the MSI/NSIS installer for this architecture
$Asset = $Release.assets | Where-Object {
    $_.name -match "OmniTransfer.*$Arch.*\.(msi|exe)$"
} | Select-Object -First 1

if (-not $Asset) {
    Write-Host "  No installer found for $Arch. Trying generic..." -ForegroundColor Yellow
    $Asset = $Release.assets | Where-Object { $_.name -match "\.(msi|exe)$" } | Select-Object -First 1
}

if (-not $Asset) {
    Write-Host "  No installer asset found. Download from:" -ForegroundColor Red
    Write-Host "  https://github.com/$RepoOwner/$RepoName/releases/tag/$Version" -ForegroundColor Cyan
    exit 1
}

$InstallerUrl = $Asset.browser_download_url
$TempPath = Join-Path $env:TEMP "omnitransfer-installer$([System.IO.Path]::GetExtension($Asset.name))"

Write-Host "  Downloading $($Asset.name)..." -ForegroundColor White
$ProgressPreference = "SilentlyContinue"
Invoke-WebRequest -Uri $InstallerUrl -OutFile $TempPath
$ProgressPreference = "Continue"

Write-Host "  Installing..." -ForegroundColor White
$ext = [System.IO.Path]::GetExtension($TempPath)
if ($ext -eq ".msi") {
    Start-Process msiexec.exe -ArgumentList "/i `"$TempPath`" /qn" -Wait
} else {
    Start-Process $TempPath -ArgumentList "/S" -Wait
}

Write-Host ""
Write-Host "  OmniTransfer $Version installed successfully!" -ForegroundColor Green
Write-Host "  Launch from the Start Menu or run: OmniTransfer" -ForegroundColor White
Write-Host ""

# Optional: add to PATH
$InstallDir = "$env:ProgramFiles\$AppName"
if (Test-Path $InstallDir) {
    $CurrentPath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
    if ($CurrentPath -notlike "*$InstallDir*") {
        [System.Environment]::SetEnvironmentVariable("PATH", "$CurrentPath;$InstallDir", "Machine")
        Write-Host "  Added to system PATH." -ForegroundColor Gray
    }
}

Remove-Item $TempPath -Force
Write-Host "  Done. Open OmniTransfer and press 'Scan' to find nearby devices." -ForegroundColor Cyan
