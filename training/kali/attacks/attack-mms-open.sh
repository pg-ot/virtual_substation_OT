#!/bin/sh
. /usr/local/bin/attack-env.sh
echo "== Unauthorized MMS OPEN to BRF01 (no protection trip, normal current) =="
station-client open
sleep 1.2
station-client read
