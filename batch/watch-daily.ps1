# ==============================================================================
# SIZU_PROJECT - Always-on daily watcher
# ==============================================================================

$ErrorActionPreference = "Stop"

$ScriptFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptFolder) {
    $ScriptFolder = $PSScriptRoot
}

$ProjectRoot = Split-Path -Parent $ScriptFolder
$RunnerScript = Join-Path $ScriptFolder "run-daily.ps1"
$LogFile = Join-Path $ScriptFolder "logs\watch-daily.log"

$RunHour = 23
$RunMinute = 0
$PollSeconds = 30

$LogFolder = Split-Path -Parent $LogFile
if (-not (Test-Path $LogFolder)) {
    New-Item -ItemType Directory -Path $LogFolder -Force | Out-Null
}

function Write-WatcherLog {
    param ([string]$Message)

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $Message"
    Write-Host $line
    $line | Out-File -FilePath $LogFile -Append -Encoding utf8
}

function Get-NextRunAt {
    param ([datetime]$Now)

    $candidate = Get-Date -Year $Now.Year -Month $Now.Month -Day $Now.Day -Hour $RunHour -Minute $RunMinute -Second 0
    if ($candidate -le $Now) {
        return $candidate.AddDays(1)
    }

    return $candidate
}

if (-not (Test-Path $RunnerScript)) {
    Write-WatcherLog "ERROR: run-daily.ps1 was not found: $RunnerScript"
    exit 1
}

Set-Location $ProjectRoot

Write-WatcherLog "SIZU_PROJECT watcher started."
Write-WatcherLog "Project root: $ProjectRoot"
Write-WatcherLog "Daily runner: $RunnerScript"

$nextRunAt = Get-NextRunAt -Now (Get-Date)
Write-WatcherLog "Next run scheduled at $($nextRunAt.ToString('yyyy-MM-dd HH:mm:ss'))."

while ($true) {
    $now = Get-Date

    if ($now -ge $nextRunAt) {
        Write-WatcherLog "Starting daily runner."

        try {
            & powershell -NoProfile -ExecutionPolicy Bypass -File $RunnerScript
            $exitCode = $LastExitCode

            if ($exitCode -eq 0) {
                Write-WatcherLog "Daily runner completed successfully."
            } else {
                Write-WatcherLog "Daily runner exited with code $exitCode."
            }
        } catch {
            Write-WatcherLog "ERROR: Daily runner failed: $_"
        }

        $nextRunAt = Get-NextRunAt -Now (Get-Date)
        Write-WatcherLog "Next run scheduled at $($nextRunAt.ToString('yyyy-MM-dd HH:mm:ss'))."
    }

    Start-Sleep -Seconds $PollSeconds
}
