@echo off
REM ============================================================
REM  Auto EDA - Production Web App
REM  Starts FastAPI on port 8000
REM ============================================================

echo.
echo ============================================================
echo   Auto EDA - Production Web App
echo ============================================================
echo.

REM Check if uvicorn is installed
python -c "import uvicorn" 2>nul
if errorlevel 1 (
    echo Installing dependencies...
    python -m pip install -r requirements-web.txt
    if errorlevel 1 (
        echo.
        echo ERROR: Could not install dependencies.
        echo Try:  python -m pip install fastapi uvicorn[standard] python-multipart
        pause
        exit /b 1
    )
)

echo Starting server at http://localhost:8000
echo.
echo (Press CTRL+C to stop)
echo.

python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
