#!/bin/bash

echo "Virtual Substation - IEC 61850 GOOSE System Installation"
echo "========================================================"

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo "Please run this script as a regular user (not root)"
   echo "The script will ask for sudo password when needed"
   exit 1
fi

# Check OS
if ! command -v apt &> /dev/null; then
    echo "This installer is designed for Ubuntu/Debian systems"
    echo "Please install dependencies manually on other systems"
    exit 1
fi

echo "Installing system dependencies..."
sudo apt update
sudo apt install -y build-essential gcc make python3 python3-tk git

echo "Checking Python tkinter..."
python3 -c "import tkinter" 2>/dev/null || {
    echo "Installing Python tkinter..."
    sudo apt install -y python3-tk
}

echo "Building libiec61850 library..."
cd libiec61850
if [ ! -f "build/libiec61850.a" ]; then
    make clean
    make lib
    if [ $? -ne 0 ]; then
        echo "Failed to build libiec61850 library"
        exit 1
    fi
else
    echo "Library already built"
fi

echo "Building GOOSE examples..."
cd examples/goose_publisher
make
cd ../goose_subscriber  
make
cd ../../..

echo "Setting up permissions..."
chmod +x *.sh

echo "Checking network interfaces..."
echo "Available network interfaces:"
ip link show | grep -E "^[0-9]+:" | awk '{print "  " $2}' | sed 's/://'

echo ""
echo "Installation completed successfully!"
echo ""
echo "Quick Start:"
echo "1. Terminal 1: sudo ./start_protection.sh <interface>"
echo "2. Terminal 2: sudo ./start_breaker.sh <interface>"
echo "3. Stop all:   ./stop_all.sh"
echo ""
echo "Example: sudo ./start_protection.sh eth0"
echo ""
echo "For help: ./check_status.sh"