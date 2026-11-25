#!/usr/bin/env bash
# Single entry point: tries the fast Docker path (pre-built images from
# GHCR, falling back to a local Docker build), then falls back to the
# native build (install.sh) if Docker itself isn't available.
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$root"

note() { printf '  - %s\n' "$1"; }

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    return 127
  fi
}

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if ! compose version >/dev/null 2>&1; then
    printf 'ERROR: Docker is installed, but Docker Compose is not.\n'
    note 'Docker Desktop includes it already; on Linux install the compose-plugin package.'
    exit 1
  fi

  printf 'Docker found. Trying pre-built images first (fastest option)...\n'
  if compose -f compose.yaml -f compose.prebuilt.yaml pull 2>/tmp/setup-pull.log; then
    printf 'Pre-built images pulled. Starting...\n'
    if compose -f compose.yaml -f compose.prebuilt.yaml up -d; then
      printf 'Running. Station HMI: http://127.0.0.1:8080/\n'
      exit 0
    fi
    printf 'ERROR: images pulled but containers failed to start. See: docker compose logs\n' >&2
    exit 1
  fi

  printf 'Pre-built images unavailable (not published yet, or no network access to ghcr.io).\n'
  note 'Falling back to a local build -- this compiles libiec61850, lib60870 and opendnp3 from source and can take several minutes.'
  if compose -f compose.yaml up -d --build; then
    printf 'Running. Station HMI: http://127.0.0.1:8080/\n'
    exit 0
  fi
  printf 'ERROR: local Docker build failed. See the output above for the failing step.\n' >&2
  exit 1
fi

printf 'Docker not found or not running. Falling back to the native build.\n'
note 'Install Docker instead for a much faster setup: https://docs.docker.com/get-docker/'
exec "$root/install.sh" "$@"
