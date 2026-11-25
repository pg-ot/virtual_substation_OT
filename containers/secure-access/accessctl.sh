#!/bin/sh
set -eu

socket=/tmp/ss01-ssh
case "${1:-}" in
  connect)
    if [ -e "$socket" ]; then
      echo "A control socket already exists; check status or disconnect first." >&2
      exit 1
    fi
    ssh -f -N -M -S "$socket" \
      -o BatchMode=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=10 \
      -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/keys/known_hosts \
      -o IdentitiesOnly=yes -i /keys/id_ed25519 \
      -L 0.0.0.0:18084:web-gateway:8090 vendor@10.77.0.1
    echo "SSH forward started. Open the host loopback URL from the training guide."
    ;;
  status)
    wg show wg0
    if ssh -S "$socket" -O check vendor@10.77.0.1 2>/dev/null; then
      echo "SSH forward: active"
    else
      echo "SSH forward: inactive"
    fi
    ;;
  disconnect)
    exec ssh -S "$socket" -O exit vendor@10.77.0.1
    ;;
  *)
    echo "Usage: accessctl connect|status|disconnect" >&2
    exit 2
    ;;
esac
