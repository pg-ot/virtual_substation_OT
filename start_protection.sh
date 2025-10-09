#!/bin/bash

if [ "$1" = "" ]; then
    echo "Usage: $0 <interface>"
    echo "Available interfaces:"
    ip link show | grep -E "^[0-9]+:" | awk '{print "  " $2}' | sed 's/://'
    exit 1
fi

INTERFACE=$1

echo "Starting Protection IED (Publisher) on interface: $INTERFACE"
echo "This will launch both the GOOSE publisher and GUI control panel"
echo ""

# Clean up any existing processes and files
echo "password" | sudo -S pkill -f goose_publisher_example 2>/dev/null || true
pkill -f protection_gui.py 2>/dev/null || true
echo "password" | sudo -S rm -f /tmp/gui_data.txt 2>/dev/null || true

# Initialize GUI data file
echo "0,0,0,50,1250.5,10500.0,49.8" > /tmp/gui_data.txt

# Start the GUI first
cd "/home/lab/virtual substation"
python3 protection_gui.py $INTERFACE &
GUI_PID=$!

# Give GUI time to start
sleep 1

# Start the GOOSE publisher example
cd libiec61850/examples/goose_publisher
echo "Starting GOOSE Publisher..."
echo "Use GUI to control protection parameters"
echo "Press Ctrl+C to stop"

sudo ./goose_publisher_example $INTERFACE &
PUBLISHER_PID=$!

# Function to cleanup
cleanup() {
    echo "\nStopping Protection IED..."
    sudo kill $PUBLISHER_PID 2>/dev/null
    kill $GUI_PID 2>/dev/null
    sudo pkill -f goose_publisher_example 2>/dev/null
    pkill -f protection_gui.py 2>/dev/null
    sudo rm -f /tmp/gui_data.txt
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Wait for either process to finish
wait $PUBLISHER_PID

# Clean up
kill $GUI_PID 2>/dev/null
rm -f /tmp/gui_data.txt

echo "Protection IED stopped"