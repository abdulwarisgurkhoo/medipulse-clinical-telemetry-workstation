@echo off
title MediPulse ICU — Smart Patient Telemetry Workstation
echo =========================================================
echo   🏥 MEDIPULSE ICU TELEMETRY DASHBOARD LAUNCHER
echo =========================================================
echo Starting local clinical telemetry server on port 8080...
echo.

cd /d "%~dp0dashboard"
start "" http://localhost:8080
python -m http.server 8080

pause
