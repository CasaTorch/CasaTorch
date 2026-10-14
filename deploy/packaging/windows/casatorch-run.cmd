@echo off
rem Started by the "CasaTorch" scheduled task (see service.ps1). Settings live in C:\ProgramData\CasaTorch.
set "CASATORCH_DATA_DIR=%ProgramData%\CasaTorch"
set "PORT=8090"
set "NODE_ENV=production"
cd /d "%~dp0app"
"%~dp0node\node.exe" server.js >> "%ProgramData%\CasaTorch\casatorch.log" 2>&1
