# ==============================================================================
# SIZU_PROJECT - Register always-on watcher at Windows logon
# ==============================================================================

$ErrorActionPreference = "Stop"

$ScriptFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptFolder) {
    $ScriptFolder = $PSScriptRoot
}

$WatcherScript = Join-Path $ScriptFolder "watch-daily.ps1"
if (-not (Test-Path $WatcherScript)) {
    Write-Error "Watcher script was not found: $WatcherScript"
    exit 1
}

$TaskName = "SizuProjectDailyWatcher"
$Description = "SIZU_PROJECT: start the always-on daily watcher at Windows logon."

Write-Host "----------------------------------------------------------------------"
Write-Host "SIZU_PROJECT watcher startup installer"
Write-Host "----------------------------------------------------------------------"
Write-Host "Watcher script: $WatcherScript"
Write-Host "Task name:      $TaskName"
Write-Host "Trigger:        At user logon"
Write-Host "----------------------------------------------------------------------"

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WatcherScript`""

$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Description $Description `
        -Force | Out-Null

    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host "Watcher startup task registered successfully." -ForegroundColor Green
    Write-Host "Task name: $TaskName" -ForegroundColor Green
    Write-Host "The watcher will start at Windows logon." -ForegroundColor Green
    Write-Host "======================================================================" -ForegroundColor Green
} catch {
    Write-Error "Failed to register watcher startup task: $_"
    exit 1
}

Read-Host "Press Enter to exit"
