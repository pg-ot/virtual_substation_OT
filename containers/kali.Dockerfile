FROM fortiphyd/grfics-attacker:latest

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl iproute2 libcap2-bin python3-scapy tcpdump tshark wireshark \
    && rm -rf /var/lib/apt/lists/*
