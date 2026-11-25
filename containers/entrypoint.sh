#!/bin/sh
set -eu

# Resolve the listener alias on its designated Compose network.
if [ -n "${LAB_BIND_NAME:-}" ]; then
    address=$(getent ahostsv4 "$LAB_BIND_NAME" | head -n 1)
    if [ -z "$address" ]; then
        printf 'Could not resolve listener alias %s\n' "$LAB_BIND_NAME" >&2
        exit 1
    fi
    export LAB_BIND_ADDRESS="${address%% *}"
fi

exec "$@"
