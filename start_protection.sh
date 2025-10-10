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
PUBLISHER_DIR="$SCRIPT_DIR/libiec61850/examples/goose_publisher"

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
        (cd "$dir" && "$SUDO" "$@") &
    else
        (cd "$dir" && "$@") &
    fi
    echo $!
}

CLEANED_UP=0
cleanup() {
    if [ "$CLEANED_UP" -eq 1 ]; then
        return
    fi
    CLEANED_UP=1

    printf '\nStopping Protection IED...\n'
    if [ -n "${PUBLISHER_PID:-}" ] && kill -0 "$PUBLISHER_PID" 2>/dev/null; then
        run_with_privileges kill "$PUBLISHER_PID" 2>/dev/null || true
    fi
    if [ -n "${GUI_PID:-}" ] && kill -0 "$GUI_PID" 2>/dev/null; then
        kill "$GUI_PID" 2>/dev/null || true
    fi
    run_with_privileges pkill -f goose_publisher_example 2>/dev/null || true
    pkill -f protection_gui.py 2>/dev/null || true
    run_with_privileges rm -f /tmp/gui_data.txt 2>/dev/null || true
}

trap cleanup SIGINT SIGTERM EXIT

echo "Starting Protection IED (Publisher) on interface: $INTERFACE"
echo "This will launch both the GOOSE publisher and GUI control panel"
echo ""

# Clean up any existing processes and files
run_with_privileges pkill -f goose_publisher_example 2>/dev/null || true
pkill -f protection_gui.py 2>/dev/null || true
run_with_privileges rm -f /tmp/gui_data.txt 2>/dev/null || true

# Initialize GUI data file
echo "0,0,0,50,1250.5,10500.0,49.8" > /tmp/gui_data.txt

# Start the GUI first
python3 "$SCRIPT_DIR/protection_gui.py" "$INTERFACE" &
GUI_PID=$!

# Give GUI time to start
sleep 1

# Start the GOOSE publisher example
echo "Starting GOOSE Publisher..."
echo "Use GUI to control protection parameters"
echo "Press Ctrl+C to stop"

PUBLISHER_PID=$(start_privileged_background "$PUBLISHER_DIR" ./goose_publisher_example "$INTERFACE")

# Wait for either process to finish
wait "$PUBLISHER_PID"

# Clean up
cleanup

echo "Protection IED stopped"
