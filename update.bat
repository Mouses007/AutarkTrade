@echo off
chcp 65001 >nul 2>nul
setlocal EnableDelayedExpansion

echo.
echo   ==============================================
echo     AutarkTrade - Update
echo   ==============================================
echo.

:: Node.js Check
where node >nul 2>nul
if errorlevel 1 (
    echo   [X] Node.js nicht gefunden! Bitte zuerst install.bat ausfuehren.
    goto :error
)
echo   [OK] Node.js gefunden

:: Datenbank-Backup
echo.
echo   [1/4] Datenbank-Backup...

if exist "autarktrade.db" (
    copy /Y "autarktrade.db" "autarktrade.db.backup" >nul
    echo   [OK] Backup erstellt: autarktrade.db.backup
) else (
    echo   [!] Keine Datenbank gefunden -- Neuinstallation? Kein Backup noetig.
)

:: Code aktualisieren
echo.
echo   [2/4] Code aktualisieren...

where git >nul 2>nul
if errorlevel 1 (
    echo   [!] Git nicht installiert -- automatisches Update nicht moeglich.
    echo.
    echo   Manuelles Update:
    echo     1. Lade das neueste Paket ueber den Link aus deiner Lizenz-Mail herunter
    echo     2. Entpacke die Dateien in diesen Ordner
    echo     3. WICHTIG: autarktrade.db NICHT ueberschreiben!
    echo     4. Druecke eine Taste um mit npm install fortzufahren...
    echo.
    pause >nul
    goto :npm_install
)

:: Git fetch + reset (funktioniert auch bei frischer Installation ohne Commits)
call scripts\paketquelle.bat
echo     git fetch origin master...
git fetch origin master
if errorlevel 1 (
    echo   [X] Git fetch fehlgeschlagen!
    echo     Tipp: Keine Internetverbindung? Zugang zur Paketquelle?
    echo     Die Paketquelle ist privat: set AT_UPDATE_TOKEN=^<Zugangsschluessel aus der Lizenz-Mail^>
    echo     und update.bat erneut starten, oder git fragt nach Benutzername und Passwort.
    goto :error
)
echo     git reset --hard origin/master...
git reset --hard origin/master
if errorlevel 1 (
    echo   [X] Git reset fehlgeschlagen!
    goto :error
)
echo   [OK] Code aktualisiert

:: npm install
:npm_install
echo.
echo   [3/4] Abhaengigkeiten aktualisieren...
echo     npm install...

call npm install
if errorlevel 1 (
    echo   [X] npm install fehlgeschlagen!
    goto :error
)
echo   [OK] Abhaengigkeiten aktualisiert

:: Build
echo.
echo   [4/4] Frontend bauen...
echo     npm run build...

call npm run build
if errorlevel 1 (
    echo   [X] Build fehlgeschlagen!
    goto :error
)
echo   [OK] Frontend gebaut

:: Erfolg
echo.
echo   ==============================================
echo     Update erfolgreich!
echo   ==============================================
echo.
echo   Datenbank: Alle Daten erhalten
if exist "autarktrade.db.backup" (
    echo   Backup:    autarktrade.db.backup
)
echo.
echo   Starte mit: start.bat
echo.
pause
exit /b 0

:: Fehler
:error
echo.
echo   Update abgebrochen. Deine Daten sind nicht betroffen.
if exist "autarktrade.db.backup" (
    echo   Backup vorhanden: autarktrade.db.backup
)
echo.
pause
exit /b 1
