@echo off
setlocal

set OPEN_BROWSER=true
if /I "%CODEY_NO_OPEN%"=="true" set OPEN_BROWSER=false
if /I "%~1"=="--no-open" set OPEN_BROWSER=false

where docker >nul 2>nul
if errorlevel 1 (
  echo.
  echo CodeY CMS could not start: Docker Desktop is not installed.
  echo Install Docker Desktop, open it, and run this launcher again.
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo.
  echo CodeY CMS could not start: Docker is not running.
  echo Open Docker Desktop, wait until it is ready, and run this launcher again.
  exit /b 1
)

docker compose version >nul 2>nul
if errorlevel 1 (
  echo.
  echo CodeY CMS could not start: Docker Compose is unavailable.
  echo Update Docker Desktop and run this launcher again.
  exit /b 1
)

if not defined API_PORT if exist .codey-local-port set /p API_PORT=<.codey-local-port
if not defined API_PORT (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$p=4000; while ($p -le 4010 -and (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue)) { $p++ }; if ($p -gt 4010) { exit 1 }; Write-Output $p"`) do set API_PORT=%%P
  if not defined API_PORT (
    echo.
    echo CodeY CMS could not start: local ports 4000 through 4010 are already in use.
    echo Close another local service and run this launcher again.
    exit /b 1
  )
)
if not exist .codey-local-port >.codey-local-port echo %API_PORT%

if not defined APP_PUBLIC_URL set APP_PUBLIC_URL=http://localhost:%API_PORT%
if not defined CORS_ORIGINS set CORS_ORIGINS=%APP_PUBLIC_URL%

set COMPOSE_FILE=docker-compose.selfhost.yml
set COMPOSE_FILES=-f %COMPOSE_FILE%
if not defined CODEY_COMPOSE_OVERRIDE_FILE set CODEY_COMPOSE_OVERRIDE_FILE=docker-compose.override.yml
if exist %CODEY_COMPOSE_OVERRIDE_FILE% set COMPOSE_FILES=%COMPOSE_FILES% -f %CODEY_COMPOSE_OVERRIDE_FILE%

echo Starting CodeY CMS at %APP_PUBLIC_URL%. The first start can take several minutes.
docker compose %COMPOSE_FILES% up -d --build --wait --wait-timeout 180
if errorlevel 1 (
  echo.
  echo CodeY CMS could not start. Review the Docker Desktop error above, then run this launcher again.
  echo Your website data was not removed.
  exit /b 1
)

for /f "usebackq delims=" %%T in (`docker compose %COMPOSE_FILES% run --rm --no-deps secrets node scripts/init-selfhost-secrets.mjs --print-install-token`) do set INSTALL_TOKEN=%%T
if not defined INSTALL_TOKEN (
  echo CodeY CMS could not create the one-time owner setup. Run this launcher again.
  exit /b 1
)

set SETUP_URL=%APP_PUBLIC_URL%/install#token=%INSTALL_TOKEN%
if "%OPEN_BROWSER%"=="true" (
  start "" "%SETUP_URL%"
  echo CodeY CMS is ready. The one-time owner setup opened in your browser.
) else (
  echo CodeY CMS is starting. Open this one-time setup URL:
  echo %SETUP_URL%
)
