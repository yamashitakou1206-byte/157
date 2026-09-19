@echo off
setlocal
py -3 -m pip install --upgrade pdfplumber
py -3 tools\build_all_official.py
if errorlevel 1 (
  echo.
  echo BUILD FAILED
  pause
  exit /b 1
)
echo.
echo BUILD COMPLETE. app\data\timetables.json was regenerated.
pause
