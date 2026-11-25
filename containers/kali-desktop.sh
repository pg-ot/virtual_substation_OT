#!/bin/sh
set -eu

# Start the upstream desktop without its GRFICS-specific route.
mkdir -p /home/kali/Desktop
chown kali:kali /home/kali/Desktop
umask 077
password=$(python3 -c 'import secrets; print(secrets.token_hex(4))')
x11vnc -storepasswd "$password" /etc/x11vnc.pass >/dev/null 2>&1
printf 'SS-01 noVNC desktop password: %s\n' "$password"
unset password
exec supervisord -n -c /opt/ss01/kali-supervisord.conf
