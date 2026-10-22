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
exit /b 0
