@echo off
chcp 65001 >nul 2>nul
setlocal EnableDelayedExpansion
echo.
echo   AutarkTrade wird beendet...
echo.

:: Nur den eigenen Server beenden (Audit SEC-OPS-015): frueher beendete
:: `taskkill /im node.exe` JEDEN Node-Prozess des Rechners. Gesucht wird der
:: node.exe, der auf dem Port von AutarkTrade lauscht (AT_PORT, Vorgabe 8080)
:: und index.mjs ausfuehrt — nur diese Prozessnummer wird beendet.
set "PORT=8080"
if defined AT_PORT set "PORT=!AT_PORT!"

set "AT_PID="
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$c = Get-NetTCPConnection -State Listen -LocalPort %PORT% -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c.OwningProcess); if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -like '*index.mjs*') { $p.ProcessId } }"`) do set "AT_PID=%%p"

if not defined AT_PID (
    echo   Server war nicht gestartet ^(kein AutarkTrade auf Port !PORT!^).
    echo.
    pause
    exit /b 0
)

taskkill /f /pid !AT_PID! >nul 2>nul
if !errorlevel! equ 0 (
    echo   [OK] Server beendet ^(Prozess !AT_PID!^).
) else (
    echo   [X] Server ^(Prozess !AT_PID!^) liess sich nicht beenden.
)
echo.
pause
