@echo off
:: Paketquelle von AutarkTrade fuer install.bat / update.bat (S10).
:: Aufruf: call scripts\paketquelle.bat   (im Installationsordner)
::
:: Quelle ist das oeffentliche Repo Mouses007/AutarkTrade (AGPL-3.0), kein Zugang noetig.
:: Optional fuer einen privaten Fork: AT_UPDATE_TOKEN und AT_UPDATE_BENUTZER. Der Token geht per GIT_CONFIG_* an git, nicht auf die Befehlszeile
:: und nicht in .git\config. Stellt eine alte Installation vom oeffentlichen Repo um.
set "AT_REPO_URL=https://github.com/Mouses007/AutarkTrade.git"
if not exist ".git\" git init -q
git remote get-url origin >nul 2>nul
if errorlevel 1 (
    git remote add origin %AT_REPO_URL%
) else (
    git remote set-url origin %AT_REPO_URL%
)
if not "%AT_UPDATE_TOKEN%"=="" (
    if "%AT_UPDATE_BENUTZER%"=="" set "AT_UPDATE_BENUTZER=x-access-token"
    for /f "usebackq delims=" %%b in (`powershell -NoProfile -Command "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($env:AT_UPDATE_BENUTZER + ':' + $env:AT_UPDATE_TOKEN))"`) do set "AT_BASIC=%%b"
)
if not "%AT_BASIC%"=="" (
    set "GIT_CONFIG_COUNT=1"
    set "GIT_CONFIG_KEY_0=http.https://github.com/.extraheader"
    set "GIT_CONFIG_VALUE_0=AUTHORIZATION: basic %AT_BASIC%"
)
:: Was geholt wird (Audit FUN-S3-002): das neueste Release-Tag vX.Y.Z, wie es die
:: Update-Pruefung meldet und Docker baut - nicht master, das nach einem Release schon
:: unfertige Commits tragen kann. Vorabversionen (Tag mit "-") zaehlen nicht. Ohne
:: Release-Tag in der Quelle bleibt es master. Gleiches Verfahren wie paketquelle_ziel
:: in scripts/paketquelle.sh. Ergebnis in der Variablen AT_ZIEL.
set "AT_ZIEL=master"
for /f "usebackq delims=" %%t in (`powershell -NoProfile -Command "$t = git ls-remote --tags --refs origin 'v*' | ForEach-Object { ($_ -split 'refs/tags/')[1] } | Where-Object { $_ -match '^v\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Substring(1) } | Select-Object -Last 1; if ($t) { 'refs/tags/' + $t }"`) do set "AT_ZIEL=%%t"
exit /b 0
