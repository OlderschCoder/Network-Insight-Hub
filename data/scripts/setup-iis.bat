@echo off
REM ============================================================
REM SCCC IT Tech Support Portal — IIS Setup Script
REM Run this from the project root after cloning the repo.
REM Requires: Node.js 20+, npm, iisnode, URL Rewrite Module
REM ============================================================

setlocal enabledelayedexpansion

echo.
echo ============================================
echo   SCCC IT Portal - IIS Deployment Setup
echo ============================================
echo.

REM ─── 1. Check Node.js is installed ──────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo         Download from: https://nodejs.org/en/download
  pause
  exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo [OK] Node.js %NODE_VER% found.

REM ─── 2. Check .env exists ────────────────────────────────────
if not exist ".env" (
  echo.
  echo [WARN] No .env file found. Copying .env.example to .env ...
  copy ".env.example" ".env" >nul
  echo [WARN] IMPORTANT: Edit .env and fill in DATABASE_URL,
  echo [WARN]            ZENDESK_API_TOKEN_SCCC, and ADMIN_PASSWORD
  echo [WARN]            before starting the application.
  echo.
) else (
  echo [OK] .env file found.
)

REM ─── 3. Install dependencies ─────────────────────────────────
echo.
echo [STEP] Installing dependencies (npm install) ...
call npm install
if %errorlevel% neq 0 (
  echo [ERROR] npm install failed. Check your network connection.
  pause
  exit /b 1
)
echo [OK] Dependencies installed.

REM ─── 4. Build the application ────────────────────────────────
echo.
echo [STEP] Building application (npm run build) ...
call npm run build
if %errorlevel% neq 0 (
  echo [ERROR] Build failed. Check the output above for errors.
  pause
  exit /b 1
)
echo [OK] Build complete. Output is in dist/

REM ─── 5. Database setup ───────────────────────────────────────
echo.
echo [STEP] Pushing database schema ...
call npm run db:push
if %errorlevel% neq 0 (
  echo [WARN] db:push failed. Make sure DATABASE_URL is set in .env
  echo [WARN] and PostgreSQL is running and accessible.
) else (
  echo [OK] Database schema is up to date.
)

REM ─── 6. Summary ──────────────────────────────────────────────
echo.
echo ============================================
echo   Setup complete!
echo ============================================
echo.
echo   Next steps:
echo   1. Make sure DATABASE_URL is set in .env (or IIS env vars)
echo   2. Make sure ZENDESK_API_TOKEN_SCCC is set
echo   3. Set ADMIN_PASSWORD to protect the /admin panel
echo   4. In IIS Manager, create a new site pointing to this folder
echo   5. Set the physical path to: %CD%
echo   6. Ensure iisnode is installed and application pool uses No Managed Code
echo   7. Visit http://your-server/api/health to verify the deployment
echo.
echo   Full setup guide: README.md
echo.
pause
