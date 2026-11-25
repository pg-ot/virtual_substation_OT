#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
tmp=$(mktemp -d)
trap 'rm -f -- "$tmp/backup.json" "$tmp/traffic.txt" "$tmp/empty.pcapng" "$tmp/result"; rmdir -- "$tmp"' EXIT

bash -n "$root/activity.sh"
find "$root/desktop" -name '*.desktop' -exec desktop-file-validate {} +
for id in 1A 1B 2A 2B 2C 2D 2E 2F 2G 3A 3B 3C 4A 4B 4C 4D 4E; do
  count=$(grep -rl "^Exec=/bin/bash /opt/ss01/practicals/activity.sh $id$" "$root/desktop" | wc -l)
  [[ $count -eq 1 ]] || { echo "Expected exactly one launcher for $id." >&2; exit 1; }
done

printf '%s\n' '{"training":"backup"}' > "$tmp/backup.json"
digest=$(sha256sum "$tmp/backup.json")
digest=${digest:0:64}
printf '%s\n%s\n' "$tmp/backup.json" "${digest^^}" | bash "$root/activity.sh" 4B > "$tmp/result"
grep -q '^MATCH:' "$tmp/result"
if printf '%s\n%064d\n' "$tmp/backup.json" 0 | bash "$root/activity.sh" 4B > "$tmp/result" 2>&1; then
  echo "Mismatch was accepted." >&2; exit 1
fi
grep -q 'MISMATCH: do not restore' "$tmp/result"
if printf '%s\nbad\n' "$tmp/backup.json" | bash "$root/activity.sh" 4B > "$tmp/result" 2>&1; then
  echo "Malformed hash was accepted." >&2; exit 1
fi
if printf '%s\n' "$tmp/missing.pcap" | bash "$root/activity.sh" 2C > "$tmp/result" 2>&1; then
  echo "Missing capture was accepted." >&2; exit 1
fi
if printf '%s\n' "$tmp/backup.json" | bash "$root/activity.sh" 2C > "$tmp/result" 2>&1; then
  echo "Non-capture file was accepted." >&2; exit 1
fi
printf '000000 00 00 00 00 00 00 00 00 00 00 00 00 08 00\n' > "$tmp/traffic.txt"
text2pcap -q "$tmp/traffic.txt" "$tmp/empty.pcapng"
printf '%s\nn\n' "$tmp/empty.pcapng" | bash "$root/activity.sh" 2C > "$tmp/result"
grep -q 'No matching decoded frames' "$tmp/result"
echo "Kali activity checks passed."
