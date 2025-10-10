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

SUDO_ENV_VARS=()
if [ -n "${LD_LIBRARY_PATH:-}" ]; then
    SUDO_ENV_VARS+=("LD_LIBRARY_PATH=$LD_LIBRARY_PATH")
fi
if [ -n "${LIBIEC61850_HOME:-}" ]; then
    SUDO_ENV_VARS+=("LIBIEC61850_HOME=$LIBIEC61850_HOME")
fi
if [ -n "${IEC61850_DATA_DIR:-}" ]; then
    SUDO_ENV_VARS+=("IEC61850_DATA_DIR=$IEC61850_DATA_DIR")
fi

EFFECTIVE_UID=$(id -u)
if [ -n "${SUDO_UID:-}" ]; then
    CALLER_UID=$SUDO_UID
    if [ -n "${SUDO_GID:-}" ]; then
        CALLER_GID=$SUDO_GID
    else
        CALLER_GID=$(id -g)
    fi
else
    CALLER_UID=$EFFECTIVE_UID
    CALLER_GID=$(id -g)
fi

if [ "$EFFECTIVE_UID" -eq 0 ]; then
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
        (cd "$dir" && "$SUDO" env \
            "${SUDO_ENV_VARS[@]}" \
            "GOOSE_FILE_OWNER_UID=$CALLER_UID" \
            "GOOSE_FILE_OWNER_GID=$CALLER_GID" \
            bash -c 'umask 022; exec "$@"' bash "$@") &
    else
        (cd "$dir" && env \
            "${SUDO_ENV_VARS[@]}" \
            "GOOSE_FILE_OWNER_UID=$CALLER_UID" \
            "GOOSE_FILE_OWNER_GID=$CALLER_GID" \
            bash -c 'umask 022; exec "$@"' bash "$@") &
    fi
    echo $!
}

start_permission_guard() {
    local uid="$CALLER_UID" gid="$CALLER_GID"

    (
        while true; do
            if [ -n "${SUBSCRIBER_PID:-}" ] && ! kill -0 "$SUBSCRIBER_PID" 2>/dev/null; then
                break
            fi

            if [ -e "$GOOSE_FILE" ]; then
                run_with_privileges chown "$uid:$gid" "$GOOSE_FILE" 2>/dev/null || true
                run_with_privileges chmod 664 "$GOOSE_FILE" 2>/dev/null || true
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
run_with_privileges chown "$CALLER_UID:$CALLER_GID" "$GOOSE_FILE" 2>/dev/null || true
run_with_privileges chmod 664 "$GOOSE_FILE" 2>/dev/null || true

# Start the GUI first (run with sudo when available)
if [ -n "$SUDO" ]; then
    "$SUDO" -E python3 "$SCRIPT_DIR/breaker_gui.py" "$INTERFACE" &
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
