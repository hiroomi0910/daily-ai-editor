# ==============================================================================
# SIZU_PROJECT - Remove watcher shortcut from the user Startup folder
# ==============================================================================

$ErrorActionPreference = "Stop"

$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "SIZU_PROJECT Daily Watcher.lnk"

if (Test-Path $ShortcutPath) {
    Remove-Item -LiteralPath $ShortcutPath -Force
    Write-Host "Startup shortcut removed: $ShortcutPath"
} else {
    Write-Host "Startup shortcut was not found: $ShortcutPath"
}
