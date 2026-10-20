@echo off
:: Alte git-Historie entfernen, nach "git reset --hard" in update.bat (Audit A3-28, F4).
:: Aufruf: call scripts\paketquelle-flach.bat   (im Installationsordner)
:: Gleiches Verfahren wie server/update-flach.js und paketquelle_flach in
:: scripts/paketquelle.sh: nur der aktuelle Zweig bleibt, HEAD wird Grenze eines
:: flachen Klons, alles Unerreichbare wird geloescht.
setlocal
set "AT_ZWEIG="
for /f "delims=" %%z in ('git symbolic-ref -q HEAD 2^>nul') do set "AT_ZWEIG=%%z"
for /f "delims=" %%r in ('git for-each-ref "--format=%%(refname)"') do (
    if not "%%r"=="%AT_ZWEIG%" git update-ref --no-deref -d "%%r"
)
for /f "delims=" %%d in ('git rev-parse --git-dir') do set "AT_GITDIR=%%d"
git rev-parse HEAD > "%AT_GITDIR%\shallow"
git reflog expire --expire=now --all
git gc --prune=now --quiet
endlocal
exit /b 0
