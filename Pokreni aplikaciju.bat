@echo off
cd /d "%~dp0"

echo Zatvaram stari server ako radi...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
timeout /t 1 /nobreak >nul

echo Pokrecem server...
start "AI Promotions Server" cmd /k "node server.js"

echo Cekam da se server podigne (5 sek)...
timeout /t 5 /nobreak >nul

echo Otvaram stranicu u browseru...
start http://localhost:3000

echo Gotovo. Aplikacija je otvorena u browseru.
echo Da ugasis aplikaciju, zatvori prozor "AI Promotions Server".
