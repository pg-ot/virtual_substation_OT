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

# Determine privilege helper
if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
else
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    else
        echo "This script requires root privileges. Run as root or install sudo." >&2
        exit 1
    fi
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

            # If subscriber died, exit the guard
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

    if [ -n "${GUI_PID:-}" ] && run_with_privileges kill -0 "$GUI_PID" 2>/dev/null; then
        run_with_privileges kill "$GUI_PID" 2>/dev/null || true
    fi

    run_with_privileges pkill -f goose_subscriber_example 2>/dev/null || true
    run_with_privileges pkill -f "$SCRIPT_DIR/breaker_gui.py" 2>/dev/null || true
    run_with_privileges rm -f "$GOOSE_FILE" 2>/dev/null || true
}

trap cleanup SIGINT SIGTERM EXIT

echo "Starting Breaker IED (Subscriber) on interface: $INTERFACE"
echo "This will launch both the GOOSE subscriber and GUI display panel"
echo ""

# Clean up any existing processes and files
run_with_privileges pkill -f goose_subscriber_example 2>/dev/null || true
run_with_privileges pkill -f "$SCRIPT_DIR/breaker_gui.py" 2>/dev/null || true
run_with_privileges rm -f "$GOOSE_FILE" 2>/dev/null || true

# Initialize GOOSE data file with safe permissions
ORIG_UMASK=$(umask)
umask 022
echo "0,0,0,50,0.0,0,49.8" > "$GOOSE_FILE"
umask "$ORIG_UMASK"
run_with_privileges chmod 664 "$GOOSE_FILE" 2>/dev/null || true

# Start the GUI
echo "Starting Breaker GUI with elevated privileges..."
if command -v python3 >/dev/null 2>&1; then
    run_with_privileges python3 "$SCRIPT_DIR/breaker_gui.py" "$INTERFACE" &
else
    echo "python3 not found. Please install Python 3.x." >&2
    exit 1
fi
GUI_PID=$!

# Give GUI time to start
sleep 1

# Start the GOOSE subscriber
echo "Starting GOOSE Subscriber..."
echo "GUI will display received protection data"
echo "Press Ctrl+C to stop both GUI and subscriber"
SUBSCRIBER_PID=$(start_privileged_background "$SUBSCRIBER_DIR" ./goose_subscriber_example "$INTERFACE")

# Start file permission guard
start_permission_guard

# Wait for subscriber to finish
wait "$SUBSCRIBER_PID" || true

# Cleanup is triggered by trap
cleanup

echo "Breaker IED stopped"
