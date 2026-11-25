#!/bin/sh
set -eu

case "${1:-}" in
  init)
    umask 077
    if [ -f /keys/server/ready ] && [ -f /keys/client/ready ] && [ -f /keys/jump/ready ]; then
      for key in /keys/server/private /keys/server/client-public \
        /keys/client/private /keys/client/server-public /keys/client/id_ed25519 \
        /keys/client/known_hosts /keys/jump/ssh_host_ed25519_key /keys/jump/authorized_keys; do
        if [ ! -s "$key" ]; then
          echo "Incomplete access keys; stop the exercise and replace only its three key volumes." >&2
          exit 1
        fi
      done
      exit 0
    fi
    if [ -n "$(find /keys/server /keys/client /keys/jump -mindepth 1 -maxdepth 1 -print -quit)" ]; then
      echo "Incomplete access keys; stop the exercise and replace only its three key volumes." >&2
      exit 1
    fi
    wg genkey > /keys/server/private
    wg pubkey < /keys/server/private > /keys/client/server-public
    wg genkey > /keys/client/private
    wg pubkey < /keys/client/private > /keys/server/client-public
    ssh-keygen -q -t ed25519 -N '' -f /keys/jump/ssh_host_ed25519_key
    ssh-keygen -q -t ed25519 -N '' -f /keys/client/id_ed25519
    cp /keys/client/id_ed25519.pub /keys/jump/authorized_keys
    awk '{print "10.77.0.1 " $1 " " $2}' /keys/jump/ssh_host_ed25519_key.pub > /keys/client/known_hosts
    chmod 755 /keys/jump
    chmod 644 /keys/jump/authorized_keys
    touch /keys/server/ready /keys/client/ready /keys/jump/ready
    echo "Generated isolated training VPN and SSH credentials."
    ;;
  vpn-server)
    ip link add wg0 type wireguard
    ip address add 10.77.0.1/32 dev wg0
    wg set wg0 listen-port 51820 private-key /keys/private \
      peer "$(cat /keys/client-public)" allowed-ips 10.77.0.2/32
    ip link set wg0 up
    ip route add 10.77.0.2/32 dev wg0
    echo "VPN ready; forwarding only VPN-side SSH to the jump host."
    exec socat TCP-LISTEN:22,bind=10.77.0.1,reuseaddr,fork TCP:access-jump:22
    ;;
  vpn-client)
    ip link add wg0 type wireguard
    ip address add 10.77.0.2/32 dev wg0
    wg set wg0 private-key /keys/private peer "$(cat /keys/server-public)" \
      allowed-ips 10.77.0.1/32 endpoint access-vpn:51820 persistent-keepalive 15
    ip link set wg0 up
    ip route add 10.77.0.1/32 dev wg0
    echo "VPN client ready. Start the SSH forward as described in the training guide."
    exec sleep infinity
    ;;
  jump)
    mkdir -p /run/sshd
    exec /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config
    ;;
  *)
    echo "Expected init, vpn-server, vpn-client or jump" >&2
    exit 2
    ;;
esac
