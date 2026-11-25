#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
build_dir=${1:-"$root/build-native"}

fail=0
note() { printf '  - %s\n' "$1"; }
missing() {
  printf 'ERROR: %s not found.\n' "$1"
  note "$2"
  fail=1
}

if [[ "$(uname -s)" != Linux* ]]; then
  printf 'ERROR: this script targets Linux (for raw-Ethernet GOOSE/SV support).\n'
  note 'On Windows or macOS, build and run through Docker instead: docker compose up -d --build'
  note 'See the Docker Compose guide: docs/container-bench.md'
  exit 1
fi

if command -v cmake >/dev/null 2>&1; then
  cmake_version=$(cmake --version | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
  cmake_major=${cmake_version%%.*}
  cmake_minor=$(echo "$cmake_version" | cut -d. -f2)
  if (( cmake_major < 3 || (cmake_major == 3 && cmake_minor < 24) )); then
    printf 'ERROR: cmake %s found, but 3.24 or later is required.\n' "$cmake_version"
    note 'Install a newer cmake, e.g. "pip install --user cmake" or https://cmake.org/download/'
    fail=1
  fi
else
  missing cmake 'sudo apt install -y cmake  (or: pip install --user cmake)'
fi

if ! { command -v g++ >/dev/null 2>&1 || command -v c++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1; }; then
  missing 'a C++17 compiler' 'sudo apt install -y build-essential'
fi

if ! command -v make >/dev/null 2>&1 && ! command -v ninja >/dev/null 2>&1; then
  missing 'a build tool (make or ninja)' 'sudo apt install -y build-essential'
fi

if ! command -v java >/dev/null 2>&1; then
  missing 'a Java runtime' 'sudo apt install -y default-jre-headless  (needed by the IEC 61850 model generator)'
fi

if command -v node >/dev/null 2>&1; then
  node_major=$(node --version | sed 's/^v//' | cut -d. -f1)
  if (( node_major < 20 )); then
    printf 'ERROR: Node.js %s found, but version 20 or later is required for the console and smoke scripts.\n' "$(node --version)"
    note 'Install Node 20+, e.g. via nvm: https://github.com/nvm-sh/nvm'
    fail=1
  fi
else
  printf 'WARNING: node not found. The build will still work, but native/smoke.mjs and the device consoles need Node.js 20+.\n'
fi

if ! curl -fsS --max-time 5 -o /dev/null https://github.com 2>/dev/null; then
  printf 'WARNING: could not reach github.com. The first configure downloads libiec61850, lib60870 and opendnp3 and will fail without internet access.\n'
fi

if [[ "$fail" -ne 0 ]]; then
  printf '\nFix the issues above, then re-run %s\n' "$0" >&2
  exit 1
fi

cmake_policy_flag=()
if command -v cmake >/dev/null 2>&1; then
  cmake_major=$(cmake --version | head -n1 | grep -oE '[0-9]+' | head -n1)
  if (( cmake_major >= 4 )); then
    cmake_policy_flag=(-DCMAKE_POLICY_VERSION_MINIMUM=3.5)
  fi
fi

if ! cmake -S "$root/native" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release "${cmake_policy_flag[@]}"; then
  printf '\nERROR: cmake configure failed. Common causes: no internet access (first run downloads dependencies), or a missing Java runtime for the model generator.\n' >&2
  exit 1
fi

if ! cmake --build "$build_dir" --parallel; then
  printf '\nERROR: build failed. Re-run with a single job for a clearer error: cmake --build %s\n' "$build_dir" >&2
  exit 1
fi

printf 'Native build ready in %s\n' "$build_dir"
