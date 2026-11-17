@echo off
rem Builds dist\Animated Lyrics\Animated Lyrics.exe and a zip you can copy to any Windows 10/11 PC.
cd /d "%~dp0"
if not exist .venv call setup.bat
.venv\Scripts\python.exe -m pip install -q pyinstaller pillow
.venv\Scripts\python.exe tools\make_icon.py
copy /y assets\icon.png web\icon.png >nul
.venv\Scripts\python.exe -m PyInstaller --noconfirm --windowed --name "Animated Lyrics" ^
  --icon "%cd%\assets\icon.ico" --add-data "%cd%\web;web" --collect-all winrt ^
  --distpath dist --workpath build --specpath build main.py
powershell -NoProfile -Command "Compress-Archive -Force -Path 'dist\Animated Lyrics' -DestinationPath 'dist\Animated-Lyrics-Windows.zip'"
echo.
echo Built: dist\Animated Lyrics\Animated Lyrics.exe
echo Zip:   dist\Animated-Lyrics-Windows.zip
