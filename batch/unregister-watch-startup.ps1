# ==============================================================================
# SIZU_PROJECT - Unregister always-on watcher startup task
# ==============================================================================

$ErrorActionPreference = "Stop"

$TaskName = "SizuProjectDailyWatcher"

try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) {
        Write-Host "Startup task is not registered: $TaskName"
        exit 0
    }

    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Startup task unregistered: $TaskName"
} catch {
    Write-Error "Failed to unregister startup task: $_"
    exit 1
}
