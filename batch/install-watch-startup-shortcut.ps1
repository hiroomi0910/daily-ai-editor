# ==============================================================================
# SIZU_PROJECT - Install watcher shortcut into the user Startup folder
# ==============================================================================

$ErrorActionPreference = "Stop"

$ScriptFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptFolder) {
    $ScriptFolder = $PSScriptRoot
}

$WatcherBat = Join-Path $ScriptFolder "watch-daily.bat"
if (-not (Test-Path $WatcherBat)) {
    Write-Error "Watcher launcher was not found: $WatcherBat"
    exit 1
}

$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "SIZU_PROJECT Daily Watcher.lnk"

try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $WatcherBat
    $shortcut.WorkingDirectory = $ScriptFolder
    $shortcut.Description = "Start SIZU_PROJECT daily watcher at Windows logon."
    $shortcut.Save()

    Write-Host "Startup shortcut installed successfully."
    Write-Host "Shortcut: $ShortcutPath"
    Write-Host "Target:   $WatcherBat"
} catch {
    Write-Error "Failed to install startup shortcut: $_"
    exit 1
}
