#!/bin/bash

echo "Virtual Substation Status Check"
echo "==============================="

echo "Running Processes:"
echo "- GOOSE Publishers:"
ps aux | grep goose_publisher_example | grep -v grep || echo "  None"

echo "- GOOSE Subscribers:"
ps aux | grep goose_subscriber_example | grep -v grep || echo "  None"

echo "- Protection GUI:"
ps aux | grep protection_gui.py | grep -v grep || echo "  None"

echo "- Breaker GUI:"
ps aux | grep breaker_gui.py | grep -v grep || echo "  None"

echo ""
echo "Data Files:"
echo "- GUI Data File:"
ls -la /tmp/gui_data.txt 2>/dev/null || echo "  Not found"

echo "- GOOSE Data File:"
ls -la /tmp/goose_data.txt 2>/dev/null || echo "  Not found"

echo ""
echo "Network Interfaces:"
ip link show | grep -E "^[0-9]+:" | awk '{print "  " $2}' | sed 's/://'