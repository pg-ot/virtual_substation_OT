#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ $# -ge 1 && $# -le 2 ]] || { printf 'Usage: %s <station-interface|-> [build-directory]\n' "$0" >&2; exit 2; }
exec node "$root/src/native-device-console.mjs" protection "$1" "${2:-"$root/build-native"}"
