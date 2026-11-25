#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
build_dir=${1:-"$root/build-native"}
cmake -S "$root/native" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build "$build_dir" --parallel
printf 'Native build ready in %s\n' "$build_dir"
