@echo off
title F1 Team Principal - Local dev server
cd /d "%~dp0"
echo Starting the local F1 Team Principal server...
echo The browser opens in a few seconds. Keep this window open; close it to stop.
echo.
start "" cmd /c "timeout /t 4 >nul ^& start "" http://localhost:5173/"
call npm.cmd run dev
pause