# ==============================================================================
# SIZU_PROJECT - Windows Task Scheduler Automatic Installer
# ==============================================================================

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
    Write-Host "======================================================================" -ForegroundColor Yellow
    Write-Host "Administrator privileges are required to register the scheduled task." -ForegroundColor Yellow
    Write-Host "Please run PowerShell as Administrator, then run this script again." -ForegroundColor Yellow
    Write-Host "======================================================================" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

$ScriptFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptFolder) {
    $ScriptFolder = $PSScriptRoot
}

$TargetScript = Join-Path $ScriptFolder "run-daily.ps1"
if (-not (Test-Path $TargetScript)) {
    Write-Error "Target script was not found: $TargetScript"
    exit 1
}

$TaskName = "SizuProjectDailyLog"
$Description = "SIZU_PROJECT: collect daily activity, generate an article, and save/publish the result."
$RunTime = "23:00"

Write-Host "----------------------------------------------------------------------"
Write-Host "SIZU_PROJECT Windows scheduled task installer"
Write-Host "----------------------------------------------------------------------"
Write-Host "Target script: $TargetScript"
Write-Host "Task name:     $TaskName"
Write-Host "Schedule:      Daily at $RunTime"
Write-Host "----------------------------------------------------------------------"

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$TargetScript`""

$Trigger = New-ScheduledTaskTrigger -Daily -At $RunTime
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Description $Description `
        -Force | Out-Null

    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host "Scheduled task registered successfully." -ForegroundColor Green
    Write-Host "Task name: $TaskName" -ForegroundColor Green
    Write-Host "Trigger:   Daily at $RunTime" -ForegroundColor Green
    Write-Host "======================================================================" -ForegroundColor Green
} catch {
    Write-Error "Failed to register scheduled task: $_"
    exit 1
}

Read-Host "Press Enter to exit"
