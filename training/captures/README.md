# SS-01 training captures

Nine reference packet captures for Session 2 (protocol analysis) and Session
2's GOOSE/MMS/IEC 104 inspection and evidence-chain practicals. Each file
isolates one operation so it opens directly to the relevant frames without
needing to hunt through a long mixed capture. All were captured from the
project's own native build (not synthetic) against a disposable Compose
project, and the resulting breaker/relay behavior was independently confirmed
through the application's own MMS reads, not just the capture.

Open any file in Wireshark; the filter column tells you what to paste in the
display-filter bar to land directly on the key frames.

| File | What it shows | Filter |
|---|---|---|
| `goose-normal-heartbeat.pcap` | Healthy relay, continuous state, no event | `goose` |
| `goose-legitimate-trip.pcap` | A **real** overcurrent trip: authentic state-number transition (stNum N → N+1, sqNum resets to 0), same source MAC throughout | `goose` |
| `goose-injection-attack.pcap` | A **forged** trip: the real heartbeat continues at its own stNum, then a frame claiming a much higher stNum arrives from a **different source MAC** | `goose && goose.stNum==125` then compare `sll.src.eth` across frames |
| `mms-close-rejected-fault.pcap` | A legitimate Close request sent while the relay is tripped → `Write-Response: failure, object-access-denied` | `mms.Write_Response_item` |
| `mms-reset-and-close-accepted.pcap` | Legitimate reset-trip, reset-latch, then Close → all accepted | `mms.Write_Response_item` |
| `mms-rogue-write-attack.pcap` | An unrecognized host writes `XCBR1$CO$Pos$Oper` directly to the breaker → accepted. No MMS-layer difference from a legitimate write; only the source IP gives it away | `mms.domainId` |
| `iec104-legitimate-control.pcap` | The real control centre's select → execute → terminate cycle, plus the live telemetry it receives | `iec60870_asdu` |
| `iec104-rogue-master-attack.pcap` | A second, unrecognized master runs the identical select/execute/terminate cycle against the gateway, which also pushes it the same live telemetry as the real control centre | `iec60870_asdu` |
| `goose-fresh-template.pcap` | A clean, current-format GOOSE frame for building a fresh injection with `containers/goose-inject.py`. The engineered dataset's field layout must match exactly; capture a fresh one if the dataset ever changes. | `goose` |

## What the captures do and do not prove

GOOSE spoofing leaves a genuine protocol-level trace: the forged frame claims
the real relay's identity (control-block reference, dataset, APPID) but
arrives from a different Ethernet source address. Comparing source
addresses across frames reveals it without any outside information.

MMS and IEC 104 do not. Both the legitimate and rogue traffic in those
captures are structurally identical — same association pattern, same
service primitives, same response codes. The only way to tell them apart is
knowing which IP addresses are the project's real devices and noticing one
that is not:

| Network | Address | Role |
|---|---|---|
| station | .2 | BRF01 (breaker) |
| station | .3 | PRF01 (protection) |
| station | .4 | station-hmi |
| station | .5 | gateway (its own MMS client) |
| station | .6 | not a provisioned device |
| supervisory | .2 | gateway |
| supervisory | .3 | control-centre |
| supervisory | .4 | not a provisioned device |

An attacker who also spoofed a legitimate IP address, rather than using an
unregistered one, would leave no trace distinguishable from these captures
alone.

These are training captures from a disposable test project, not production
evidence or a conformance claim. See [as-built.md](../../docs/as-built.md)
and [scenario-test-cases.md](../../docs/scenario-test-cases.md) for the
project's broader evidence conventions.
