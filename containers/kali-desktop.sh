#!/bin/sh
set -eu

# Start the upstream desktop without its GRFICS-specific route.
mkdir -p /home/kali/Desktop
chown kali:kali /home/kali/Desktop

# Grant the unprivileged kali desktop user raw-socket access so the
# training attack scripts (packet capture, GOOSE injection) run from a
# terminal in the noVNC desktop without sudo, which no-new-privileges
# blocks for that session. tcpdump is a standalone binary, so it is
# capped directly. python3 is not: it is also the shebang interpreter
# for system tools such as supervisord, and the kernel refuses to exec
# any script through an interpreter that carries file capabilities. A
# private copy, used only by the GOOSE injector, avoids that.
setcap cap_net_raw+eip "$(readlink -f "$(command -v tcpdump)")"
cp "$(readlink -f "$(command -v python3)")" /usr/local/bin/python3-rawcap
setcap cap_net_raw+eip /usr/local/bin/python3-rawcap

# Make the instructor-run live attack demo scripts (training/kali/attacks)
# and the GOOSE forger they use available on PATH for any terminal opened
# in the desktop, including as the unprivileged kali user.
cp /opt/ss01/practicals/attacks/*.sh /usr/local/bin/
cp /opt/ss01/goose-inject.py /usr/local/bin/goose-inject.py
chmod +x /usr/local/bin/attack-*.sh /usr/local/bin/restore-baseline.sh /usr/local/bin/goose-inject.py

umask 077
password='ss01kali'
x11vnc -storepasswd "$password" /etc/x11vnc.pass >/dev/null 2>&1
printf 'SS-01 noVNC desktop password: %s\n' "$password"
unset password
exec supervisord -n -c /opt/ss01/kali-supervisord.conf
