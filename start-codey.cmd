@echo off
setlocal
set COMPOSE_FILE=docker-compose.selfhost.yml
set COMPOSE_FILES=-f %COMPOSE_FILE%
if exist docker-compose.override.yml set COMPOSE_FILES=%COMPOSE_FILES% -f docker-compose.override.yml

docker compose %COMPOSE_FILES% up -d --build --wait --wait-timeout 180
if errorlevel 1 exit /b 1

for /f "usebackq delims=" %%T in (`docker compose %COMPOSE_FILES% run --rm --no-deps secrets node scripts/init-selfhost-secrets.mjs --print-install-token`) do set INSTALL_TOKEN=%%T
if not defined INSTALL_TOKEN exit /b 1

set SETUP_URL=http://localhost:4000/install
start "" "%SETUP_URL%#token=%INSTALL_TOKEN%"
echo CodeY CMS is starting. Open %SETUP_URL%
