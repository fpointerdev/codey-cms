#!/bin/sh
set -eu

compose_file="docker-compose.selfhost.yml"

compose() {
  if [ -f "docker-compose.override.yml" ]; then
    docker compose -f "$compose_file" -f "docker-compose.override.yml" "$@"
  else
    docker compose -f "$compose_file" "$@"
  fi
}

compose up -d --build --wait --wait-timeout 180

install_token="$(compose run --rm --no-deps secrets node scripts/init-selfhost-secrets.mjs --print-install-token)"
install_url="${CODEY_SETUP_URL:-http://localhost:4000/install}#token=${install_token}"
opened=false

case "$(uname -s)" in
  Darwin) open "$install_url" && opened=true || true ;;
  Linux)
    if command -v xdg-open >/dev/null 2>&1 && xdg-open "$install_url" >/dev/null 2>&1; then
      opened=true
    fi
    ;;
esac

if [ "$opened" = true ]; then
  printf 'CodeY CMS is starting. Complete setup in the opened browser.\n'
else
  printf 'CodeY CMS is starting. Open this one-time setup URL:\n%s\n' "$install_url"
fi
