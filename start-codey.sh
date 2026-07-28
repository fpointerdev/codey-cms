#!/bin/sh
set -eu

compose_file="docker-compose.selfhost.yml"
override_file="${CODEY_COMPOSE_OVERRIDE_FILE:-docker-compose.override.yml}"
open_browser=true

if [ "${CODEY_NO_OPEN:-false}" = "true" ] || [ "${1:-}" = "--no-open" ]; then
  open_browser=false
fi

fail() {
  printf '\nCodeY CMS could not start: %s\n' "$1" >&2
  printf 'Keep this window open and follow the instruction above. Your website data was not removed.\n' >&2
  exit 1
}

if ! command -v docker >/dev/null 2>&1; then
  fail "Docker Desktop is not installed. Install Docker Desktop, open it, and run this launcher again."
fi

if ! docker info >/dev/null 2>&1; then
  fail "Docker is not running. Open Docker Desktop, wait until it is ready, and run this launcher again."
fi

if ! docker compose version >/dev/null 2>&1; then
  fail "Docker Compose is unavailable. Update Docker Desktop and run this launcher again."
fi

port_in_use() {
  port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -Eq "[:.]${port}[[:space:]]"
    return
  fi

  return 1
}

port_file=".codey-local-port"
if [ -z "${API_PORT:-}" ] && [ -f "$port_file" ]; then
  saved_port="$(cat "$port_file")"
  case "$saved_port" in
    ''|*[!0-9]*) ;;
    *) API_PORT="$saved_port" ;;
  esac
fi

if [ -z "${API_PORT:-}" ]; then
  API_PORT=4000
  while [ "$API_PORT" -le 4010 ] && port_in_use "$API_PORT"; do
    API_PORT=$((API_PORT + 1))
  done

  if [ "$API_PORT" -gt 4010 ]; then
    fail "Local ports 4000 through 4010 are already in use. Close another local service and try again."
  fi

  printf '%s\n' "$API_PORT" > "$port_file"
fi

APP_PUBLIC_URL="${APP_PUBLIC_URL:-http://localhost:${API_PORT}}"
CORS_ORIGINS="${CORS_ORIGINS:-$APP_PUBLIC_URL}"
export API_PORT APP_PUBLIC_URL CORS_ORIGINS

compose() {
  if [ -f "$override_file" ]; then
    docker compose -f "$compose_file" -f "$override_file" "$@"
  else
    docker compose -f "$compose_file" "$@"
  fi
}

printf 'Starting CodeY CMS at %s. The first start can take several minutes.\n' "$APP_PUBLIC_URL"
if ! compose up -d --build --wait --wait-timeout 180; then
  fail "Docker could not prepare the website. Review the Docker Desktop error above, then run this launcher again."
fi

install_token="$(compose run --rm --no-deps secrets node scripts/init-selfhost-secrets.mjs --print-install-token)"
if [ -z "$install_token" ]; then
  fail "The one-time owner setup could not be created. Run this launcher again."
fi

install_url="${CODEY_SETUP_URL:-${APP_PUBLIC_URL}/install}#token=${install_token}"
opened=false

if [ "$open_browser" = true ]; then
  case "$(uname -s)" in
    Darwin) open "$install_url" && opened=true || true ;;
    Linux)
      if command -v xdg-open >/dev/null 2>&1 && xdg-open "$install_url" >/dev/null 2>&1; then
        opened=true
      fi
      ;;
  esac
fi

if [ "$opened" = true ]; then
  printf 'CodeY CMS is starting. Complete setup in the opened browser.\n'
else
  printf 'CodeY CMS is starting. Open this one-time setup URL:\n%s\n' "$install_url"
fi
