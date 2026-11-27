# Live attack demo scripts

Instructor-run, not trainee-facing: unlike `training/kali/activity.sh` (passive
capture and analysis), these scripts actually send unauthorized commands and
forged frames against the running lab, to demonstrate the protocol
vulnerabilities live.

Requires `compose.kali-demo.yaml` (joins Kali to the `station` and `process`
networks in addition to its default `supervisory` placement -- see that
file's own warning) and a running lab. `kali-desktop.sh` copies these scripts
into the Kali container's `/usr/local/bin` on every start, so they are on
`PATH` for any terminal opened in the noVNC desktop, including as the
unprivileged `kali` user.

| Script | What it demonstrates |
|---|---|
| `attack-read.sh` | Baseline MMS read: BRF01 position, PRF01 trip/current |
| `attack-mms-open.sh` | Unauthorized MMS OPEN to BRF01 -- integrity: breaker opens with no protection trip and normal current |
| `attack-iec104-open.sh` | Unauthorized IEC 104 master OPEN to the gateway -- same integrity gap, over the supervisory protocol |
| `attack-goose-trip.sh` | Forged Layer 2 GOOSE trip from a different source MAC -- BRF01 accepts it with no authentication |
| `restore-baseline.sh` | Resets the latch and closes BRF01 back to the CLOSED, normal-current baseline between demos |

Run `restore-baseline.sh` after each attack before starting the next one. If
`restore-baseline.sh` reports `INVALID` current or trip, the presenter's own
browser tab lost its HTTP current-input lease -- open the station page
(http://127.0.0.1:8080), click "Apply slider value" at 120 A, then rerun it.
After the GOOSE attack specifically, the first `restore-baseline.sh` call
sometimes comes back `REJECTED` while BRF01 settles from the forged frame;
run it again and it accepts normally.

## One-time setup per lab start

`station-client` and `telecontrol104` are native binaries built into every
`ss01-bench:dev` service image, not into the Kali image. Copy them in before
the first attack:

```bash
docker cp ss01-bench-breaker-1:/usr/local/bin/station-client - | docker cp - ss01-bench-kali-1:/usr/local/bin/station-client
docker cp ss01-bench-gateway-1:/usr/local/bin/telecontrol104 - | docker cp - ss01-bench-kali-1:/usr/local/bin/telecontrol104
docker exec ss01-bench-kali-1 chmod +x /usr/local/bin/station-client /usr/local/bin/telecontrol104
```

(Replace the container names with whatever your Compose project prefixes
them as, e.g. `docker compose ps` to check.) `containers/goose-inject.py`
and this directory's scripts are copied into `/usr/local/bin` automatically
by `kali-desktop.sh` on every container start -- nothing to do for those.
