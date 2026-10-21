@echo off
rem Lance NEXUS en mode developpement (double-clic ou depuis un terminal).
rem Utilise npm.cmd : fonctionne meme si PowerShell bloque les scripts .ps1.
cd /d "%~dp0"
call npm.cmd run app
if errorlevel 1 pause
