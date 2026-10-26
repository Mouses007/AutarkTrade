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

:: Per VACUUM INTO statt copy (Audit SEC-OPS-015): die Datenbank laeuft im
:: WAL-Modus, ein copy der Datei allein verliert, was noch in -wal steht.
if exist "autarktrade.db" (
    node scripts\sqlite-sicherung.mjs autarktrade.db autarktrade.db.backup
    if errorlevel 1 (
        echo   [X] Backup fehlgeschlagen -- Update abgebrochen.
        goto :error
    )
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
    echo     1. Lade das neueste Paket von github.com/Mouses007/AutarkTrade/releases herunter
    echo     2. Entpacke die Dateien in diesen Ordner
    echo     3. WICHTIG: autarktrade.db NICHT ueberschreiben!
    echo     4. Druecke eine Taste um mit npm install fortzufahren...
    echo.
    pause >nul
    goto :npm_install
)

:: Git fetch + reset (funktioniert auch bei frischer Installation ohne Commits)
call scripts\paketquelle.bat
echo     git fetch --depth 1 origin master...
git fetch --depth 1 --no-tags origin master
if errorlevel 1 (
    echo   [X] Git fetch fehlgeschlagen!
    echo     Tipp: Keine Internetverbindung? Zugang zur Paketquelle?
    echo     Quelle: github.com/Mouses007/AutarkTrade ^(oeffentlich^).
    goto :error
)
echo     git reset --hard FETCH_HEAD...
git reset --hard FETCH_HEAD
if errorlevel 1 (
    echo   [X] Git reset fehlgeschlagen!
    goto :error
)
:: Alte Historie entfernen (nur der ausgelieferte Stand bleibt)
call scripts\paketquelle-flach.bat >nul 2>nul
echo   [OK] Code aktualisiert
:: git ist fertig: Zugang aus der Umgebung nehmen, npm und seine Skripte sehen ihn nicht (SEC-OPS-008)
set "GIT_CONFIG_COUNT="
set "GIT_CONFIG_KEY_0="
set "GIT_CONFIG_VALUE_0="
set "AT_BASIC="
set "AT_UPDATE_TOKEN="
set "AT_UPDATE_BENUTZER="

:: npm install
:npm_install
echo.
echo   [3/4] Abhaengigkeiten aktualisieren...
echo     npm ci...

:: npm ci nach package-lock.json (genau die geprueften Versionen), sonst npm install
set "NPM_OK=0"
if exist "package-lock.json" (
    call npm ci
    if not errorlevel 1 set "NPM_OK=1"
    if "!NPM_OK!"=="0" echo     npm ci fehlgeschlagen -- versuche npm install
)
if "!NPM_OK!"=="0" (
    call npm install
    if errorlevel 1 (
        echo   [X] npm install fehlgeschlagen!
        goto :error
    )
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
