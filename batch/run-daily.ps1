# ==============================================================================
# SIZU_PROJECT - Windows Daily Batch Execution Script
# ==============================================================================

$ErrorActionPreference = "Stop"

$ScriptFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptFolder) {
    $ScriptFolder = $PSScriptRoot
}

$ProjectRoot = Split-Path -Parent $ScriptFolder
Set-Location $ProjectRoot

$LogFile = Join-Path $ScriptFolder "logs\daily.log"
$EnvPath = Join-Path $ProjectRoot ".env"

$LogFolder = Split-Path -Parent $LogFile
if (-not (Test-Path $LogFolder)) {
    New-Item -ItemType Directory -Path $LogFolder -Force | Out-Null
}

function Send-Notification {
    param (
        [string]$Title,
        [string]$Message,
        [string]$Status
    )

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMsg = "[$timestamp] [Notification] ${Title}: $Message"
    Write-Host $logMsg
    $logMsg | Out-File -FilePath $LogFile -Append -Encoding utf8

    if ($env:OS -like "*Windows*") {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            Add-Type -AssemblyName System.Drawing

            $global:notification = New-Object System.Windows.Forms.NotifyIcon
            $global:notification.Icon = [System.Drawing.SystemIcons]::Information
            $global:notification.BalloonTipTitle = $Title
            $global:notification.BalloonTipText = $Message

            if ($Status -eq "Success") {
                $global:notification.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
            } else {
                $global:notification.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Error
            }

            $global:notification.Visible = $true
            $global:notification.ShowBalloonTip(5000)
            Start-Sleep -Seconds 2
            $global:notification.Dispose()
        } catch {
            # Ignore notification failures on non-interactive desktop sessions.
        }
    }
}

$Header = "`n======================================================================`n[BATCH START] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n======================================================================`nArguments: $args"
$Header | Out-File -FilePath $LogFile -Append -Encoding utf8

Write-Host "Loading environment variables from .env..."
if (Test-Path $EnvPath) {
    Get-Content $EnvPath | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $index = $line.IndexOf("=")
            $key = $line.Substring(0, $index).Trim()
            $val = $line.Substring($index + 1).Trim()

            if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
                $val = $val.Substring(1, $val.Length - 2)
            }

            [System.Environment]::SetEnvironmentVariable($key, $val, [System.EnvironmentVariableTarget]::Process)
        }
    }
    Write-Host "Environment variables loaded successfully."
} else {
    Send-Notification -Title "SIZU_PROJECT warning" -Message ".env file not found. Using defaults." -Status "Warning"
}

$NodeCheck = Get-Command node -ErrorAction SilentlyContinue
$NpmCheck = Get-Command npm -ErrorAction SilentlyContinue

if (-not $NodeCheck -or -not $NpmCheck) {
    $errMsg = "Node.js or npm is not available in PATH. Please install and try again."
    Send-Notification -Title "SIZU_PROJECT error" -Message $errMsg -Status "Error"
    exit 1
}

$NodeModulesPath = Join-Path $ProjectRoot "node_modules"
if (-not (Test-Path $NodeModulesPath)) {
    Write-Host "node_modules not found. Installing dependencies..."
    try {
        & npm install 2>&1 | Out-File -FilePath $LogFile -Append -Encoding utf8
        Write-Host "npm install completed."
    } catch {
        Send-Notification -Title "SIZU_PROJECT error" -Message "npm install failed. Check the log." -Status "Error"
        exit 1
    }
}

Write-Host "Compiling TypeScript..."
try {
    & npm run build 2>&1 | Out-File -FilePath $LogFile -Append -Encoding utf8
    Write-Host "TypeScript compilation completed."
} catch {
    Send-Notification -Title "SIZU_PROJECT error" -Message "TypeScript build failed." -Status "Error"
    exit 1
}

Write-Host "Starting SIZU_PROJECT diary pipeline..."
try {
    & node dist/index.js $args 2>&1 | ForEach-Object {
        $line = $_.ToString()
        Write-Host $line
        $line | Out-File -FilePath $LogFile -Append -Encoding utf8
    }

    $ExitCode = $LastExitCode
    if ($ExitCode -eq 0) {
        Send-Notification -Title "SIZU_PROJECT success" -Message "Daily pipeline completed successfully." -Status "Success"
    } else {
        Send-Notification -Title "SIZU_PROJECT error" -Message "Program exited with code ${ExitCode}." -Status "Error"
    }
} catch {
    Send-Notification -Title "SIZU_PROJECT fatal error" -Message "Unexpected error: $_" -Status "Error"
    exit 1
}

$Footer = "----------------------------------------------------------------------`n[BATCH END] $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n======================================================================"
$Footer | Out-File -FilePath $LogFile -Append -Encoding utf8
