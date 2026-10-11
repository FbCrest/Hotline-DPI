@echo off
:: Hotline DPI - Launcher (yêu cầu Administrator)
NET SESSION >nul 2>&1
if %errorLevel% neq 0 (
    echo Dang khoi dong lai voi quyen Administrator...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
npm start
