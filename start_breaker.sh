#!/bin/bash

if [ "$1" = "" ]; then
    echo "Usage: $0 <interface>"
    echo "Available interfaces:"
    ip link show | grep -E "^[0-9]+:" | awk '{print "  " $2}' | sed 's/://'
    exit 1
fi

INTERFACE=$1

echo "Starting Breaker IED (Subscriber) on interface: $INTERFACE"
echo "This will launch both the GOOSE subscriber and GUI display panel"
echo ""

# Clean up any existing processes and files
echo "password" | sudo -S pkill -f goose_subscriber_example 2>/dev/null || true
pkill -f breaker_gui.py 2>/dev/null || true
echo "password" | sudo -S rm -f /tmp/goose_data.txt 2>/dev/null || true

# Initialize GOOSE data file
echo "0,0,0,50,0.0,0,49.8" > /tmp/goose_data.txt

# Start the GUI first
cd "/home/lab/virtual substation"
python3 breaker_gui.py $INTERFACE &
GUI_PID=$!

# Give GUI time to start
sleep 1

# Start the GOOSE subscriber example
cd libiec61850/examples/goose_subscriber
echo "Starting GOOSE Subscriber..."
echo "GUI will display received protection data"
echo "Press Ctrl+C to stop both GUI and subscriber"

sudo ./goose_subscriber_example $INTERFACE &
SUBSCRIBER_PID=$!

# Function to cleanup
cleanup() {
    echo "\nStopping Breaker IED..."
    sudo kill $SUBSCRIBER_PID 2>/dev/null
    kill $GUI_PID 2>/dev/null
    sudo pkill -f goose_subscriber_example 2>/dev/null
    pkill -f breaker_gui.py 2>/dev/null
    sudo rm -f /tmp/goose_data.txt
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Wait for either process to finish
wait $SUBSCRIBER_PID

# Clean up
kill $GUI_PID 2>/dev/null
rm -f /tmp/goose_data.txt

echo "Breaker IED stopped"