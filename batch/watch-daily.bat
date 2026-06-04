@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ======================================================================
echo SIZU_PROJECT - Always-on daily watcher
echo ======================================================================
echo This window keeps running and starts run-daily.ps1 every day at 23:00.
echo Watcher logs are written to logs\watch-daily.log.
echo Close this window to stop the watcher.
echo ----------------------------------------------------------------------

powershell -NoProfile -ExecutionPolicy Bypass -File .\watch-daily.ps1

echo ----------------------------------------------------------------------
echo Watcher stopped.
echo ======================================================================
pause
