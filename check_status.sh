#!/usr/bin/env bash
set -u
status=0
for port in 8211 8212; do
    printf 'Device console %s\n' "$port"
    if ! curl -fsS --max-time 2 "http://127.0.0.1:$port/state"; then status=1; fi
    printf '\n'
done
exit "$status"
