@echo off
title SBI Group
cd /d "%~dp0"

echo.
echo  ========================================
echo    SBI Group - Pokretanje aplikacije
echo  ========================================
echo.

echo Zatvaram stari server ako radi...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul
timeout /t 1 /nobreak >nul

echo Pokrecem server...
start "SBI Group Server" cmd /k "node server.js"

echo Cekam da se server podigne (5 sek)...
timeout /t 5 /nobreak >nul

echo Otvaram SBI Group u browseru...
start http://localhost:3000

echo.
echo  Gotovo. Aplikacija je otvorena u browseru.
echo  Da ugasis server, zatvori prozor "SBI Group Server".
echo.
timeout /t 3 /nobreak >nul
