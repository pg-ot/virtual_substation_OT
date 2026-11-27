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

## Setup

Nothing to do: `station-client` and `telecontrol104` are built from the
same native sources as the bench image (see `containers/kali.Dockerfile`)
and baked into the Kali image itself. `containers/goose-inject.py` and this
directory's scripts are copied into `/usr/local/bin` automatically by
`kali-desktop.sh` on every container start. Just open a terminal in the
noVNC desktop and run the scripts by name.
