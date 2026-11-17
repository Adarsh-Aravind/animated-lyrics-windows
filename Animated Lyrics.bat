@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\pythonw.exe (
  echo First run: installing...
  call setup.bat
)
start "" .venv\Scripts\pythonw.exe main.py %*
