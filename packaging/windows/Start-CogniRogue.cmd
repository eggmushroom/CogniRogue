@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0runtime\python\python.exe" (
    echo CogniRogue files are missing. Extract the whole ZIP before launching.
    pause
    exit /b 1
)
"%~dp0runtime\python\python.exe" -I -B -X utf8 "%~dp0launcher.py" %*
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
    echo.
    echo CogniRogue could not start. See the message above.
    pause
)
exit /b %RESULT%
