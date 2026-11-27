#!/bin/sh
. /usr/local/bin/attack-env.sh
echo "== Restoring CLOSED baseline =="
station-client reset-latch
sleep 0.5
station-client close
sleep 1.2
station-client read
echo
echo "If current/trip show INVALID above, go to the station page (http://127.0.0.1:8080),"
echo "click 'Apply slider value' at 120 A, then run this script again."
