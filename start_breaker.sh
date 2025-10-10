#!/bin/bash

set -euo pipefail

if [ "${1:-}" = "" ]; then
    echo "Usage: $0 <interface>"
    echo "Available interfaces:"
    if command -v ip >/dev/null 2>&1; then
        ip link show | grep -E "^[0-9]+:" | awk '{print "  " $2}' | sed 's/://' 
    else
        echo "  (ip command not found; cannot list interfaces)"
    fi
    exit 1
fi

INTERFACE=$1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBSCRIBER_DIR="$SCRIPT_DIR/libiec61850/examples/goose_subscriber"
GOOSE_FILE="/tmp/goose_data.txt"
PERMISSION_GUARD_PID=""

if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
elif command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
else
    echo "This script requires root privileges. Run as root or install sudo." >&2
    exit 1
fi

run_with_privileges() {
    if [ -n "$SUDO" ]; then
        "$SUDO" "$@"
    else
        "$@"
    fi
}

start_privileged_background() {
    local dir="$1"
    shift
    if [ -n "$SUDO" ]; then
        (cd "$dir" && "$SUDO" bash -c 'umask 022; exec "$@"' bash "$@") &
    else
        (cd "$dir" && umask 022 && "$@") &
    fi
    echo $!
}

start_permission_guard() {
    local uid gid
    uid=$(id -u)
    gid=$(id -g)

    (
        while true; do
            if [ -e "$GOOSE_FILE" ]; then
                if run_with_privileges chown "$uid:$gid" "$GOOSE_FILE" 2>/dev/null \
                    && run_with_privileges chmod 664 "$GOOSE_FILE" 2>/dev/null; then
                    break
                fi
            fi

            if [ -n "${SUBSCRIBER_PID:-}" ] && ! kill -0 "$SUBSCRIBER_PID" 2>/dev/null; then
                break
            fi

            sleep 1
        done
    ) &

    PERMISSION_GUARD_PID=$!
}

CLEANED_UP=0
cleanup() {
    if [ "$CLEANED_UP" -eq 1 ]; then
        return
    fi
    CLEANED_UP=1

    printf '\nStopping Breaker IED...\n'
    if [ -n "${SUBSCRIBER_PID:-}" ] && kill -0 "$SUBSCRIBER_PID" 2>/dev/null; then
        run_with_privileges kill "$SUBSCRIBER_PID" 2>/dev/null || true
    fi
    if [ -n "${PERMISSION_GUARD_PID:-}" ] && kill -0 "$PERMISSION_GUARD_PID" 2>/dev/null; then
        kill "$PERMISSION_GUARD_PID" 2>/dev/null || true
        wait "$PERMISSION_GUARD_PID" 2>/dev/null || true
    fi
    if [ -n "${GUI_PID:-}" ]; then
        if [ -n "$SUDO" ]; then
            if "$SUDO" kill -0 "$GUI_PID" 2>/dev/null; then
                "$SUDO" kill "$GUI_PID" 2>/dev/null || true
            fi
        elif kill -0 "$GUI_PID" 2>/dev/null; then
            kill "$GUI_PID" 2>/dev/null || true
        fi
    fi
    run_with_privileges pkill -f goose_subscriber_example 2>/dev/null || true
    if [ -n "$SUDO" ]; then
        "$SUDO" pkill -f breaker_gui.py 2>/dev/null || true
    else
        pkill -f breaker_gui.py 2>/dev/null || true
    fi
    run_with_privileges rm -f "$GOOSE_FILE" 2>/dev/null || true
}

trap cleanup SIGINT SIGTERM EXIT

echo "Starting Breaker IED (Subscriber) on interface: $INTERFACE"
echo "This will launch both the GOOSE subscriber and GUI display panel"
echo ""

# Clean up any existing processes and files
run_with_privileges pkill -f goose_subscriber_example 2>/dev/null || true
if [ -n "$SUDO" ]; then
    "$SUDO" pkill -f breaker_gui.py 2>/dev/null || true
else
    pkill -f breaker_gui.py 2>/dev/null || true
fi
run_with_privileges rm -f "$GOOSE_FILE" 2>/dev/null || true

# Initialize GOOSE data file
ORIG_UMASK=$(umask)
umask 022
echo "0,0,0,50,0.0,0,49.8" > "$GOOSE_FILE"
umask "$ORIG_UMASK"

# Start the GUI first (run with sudo when available)
if [ -n "$SUDO" ]; then
    "$SUDO" python3 "$SCRIPT_DIR/breaker_gui.py" "$INTERFACE" &
else
    python3 "$SCRIPT_DIR/breaker_gui.py" "$INTERFACE" &
fi
GUI_PID=$!

# Give GUI time to start
sleep 1

# Start the GOOSE subscriber example
echo "Starting GOOSE Subscriber..."
echo "GUI will display received protection data"
echo "Press Ctrl+C to stop both GUI and subscriber"

SUBSCRIBER_PID=$(start_privileged_background "$SUBSCRIBER_DIR" ./goose_subscriber_example "$INTERFACE")
start_permission_guard

# Wait for either process to finish
wait "$SUBSCRIBER_PID"

# Clean up
cleanup

echo "Breaker IED stopped"
