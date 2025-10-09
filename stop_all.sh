#!/bin/bash

echo "Stopping Virtual Substation - All IEDs and GUIs"
echo "================================================"

# Kill all GOOSE-related processes
echo "Stopping GOOSE Publisher processes..."
sudo pkill -f goose_publisher_example
sudo pkill -f gui_publisher

echo "Stopping GOOSE Subscriber processes..."
sudo pkill -f goose_subscriber_example

echo "Stopping Protection GUI..."
pkill -f protection_gui.py

echo "Stopping Breaker GUI..."
pkill -f breaker_gui.py

echo "Stopping Python GUI processes..."
pkill -f "python3.*protection_gui"
pkill -f "python3.*breaker_gui"

# Clean up temporary files
echo "Cleaning up temporary files..."
sudo rm -f /tmp/gui_publisher*
sudo rm -f /tmp/gui_data.txt
sudo rm -f /tmp/goose_data.txt

# Wait for processes to fully terminate
sleep 2

echo "All Virtual Substation processes stopped."
echo "System is ready for restart."