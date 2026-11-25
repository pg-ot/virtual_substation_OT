# SS-01 / F01 as-built reference

This describes the repository's implemented training configuration as of
23 November 2026. A running image may differ from the source; see the dated
deployment snapshot below and inspect the actual project before operating it.
This is not an industrial protection system, a real-time guarantee, or a
claim of protocol conformance.

## Devices and signal paths

| Asset | Implemented role | Interface |
|---|---|---|
| SIMF01 | Numerical feeder and breaker mechanism; owns 52a/52b contacts and process fault state | Process-side MMS server; simulator and 3D yard web pages |
| PRF01 | Feeder protection; evaluates phase-A RMS current, latches trip, publishes measurements | MMS server and station GOOSE publisher |
| BRF01 | Breaker control; receives protection trip, checks interlocks, requests plant operation, derives position from contacts | Station GOOSE subscriber, process MMS client, station MMS server |
| Station HMI | Single-line, breaker control, indications, events and lab overview | MMS client; loopback web server; optional direct HTTP input to PRF01; capture controls use a separate host agent |
| IEC 104 gateway / control centre | MMS-to-IEC 104 monitoring and supervised simulated switching through a separate master | Station MMS and supervisory IEC 104 |
| DNP3 gateway / control centre | Optional MMS-to-DNP3 monitoring and a separate simulated master | Station MMS and supervisory DNP3 |
| MUF01 | Experimental synthetic Sampled Values publisher | Optional SV process network; separate from HTTP input |
| Kali | Optional analysis desktop | Supervisory and isolated desktop access networks; not part of the protection path |

```text
Current source ──> PRF01 ── GOOSE trip + quality ──> BRF01
                                                         │ MMS actuator
                                                         ▼
                                                   SIMF01 breaker
                                                         │ 52a / 52b, MMS
                                                         ▼
Station HMI and gateways <── MMS position / quality ── BRF01
              │
              └── gateways ── IEC 104 or optional DNP3 monitoring ──> masters
                  IEC 104 master ── select / execute ──> gateway ── MMS ──> BRF01
```

The current source is **one** of plant MMS (base profile), manual HTTP
input to PRF01 via the station HMI (optional), or experimental SV (optional). HTTP and SV are mutually
exclusive. SIMF01 still supplies fault state and breaker process data in HTTP
mode. HTTP injection does not change the plant's own current or voltage.

**No BRF01-to-PRF01 position GOOSE is implemented.** BRF01's independent
contact-derived position is available over MMS to the station and gateways.
GOOSE trip receipt is not a breaker-position acknowledgement. A reverse
position GOOSE or a breaker-failure protection function would need a separate
engineered dataset, subscriber logic, supervision and acceptance tests; neither
is implied by the present operation-failure alarm.

### Protection and GOOSE

The default PRF01 training pickup is **200 A**, with **0 ms** intentional
delay. `LAB_PROTECTION_PICKUP_A` and `LAB_PROTECTION_DELAY_MS` configure the
values at startup. Pickup starts at or above the setting; below-pickup or
unavailable current resets the pickup timer. Once tripped, PRF01 retains its
latch until an explicit permitted reset. Reset requires cleared plant fault
and valid current below pickup; HTTP mode also requires plant availability.
BRF01's close-inhibit latch is separate. Reset and close are separate actions.
See [native settings and reset procedure](../native/README.md#training-protection-settings).

The source [CID](../native/feeder.cid) specifies:

| GOOSE field | Configured value |
|---|---|
| Publisher → subscriber | PRF01 → BRF01 |
| Control block / dataset | `PRF01LD0/LLN0$GO$Protection` / `PRF01LD0/LLN0$ProtectionData` |
| Dataset members, in order | `PTRC1.Tr.general`, `PTRC1.Tr.q` |
| APPID / destination | `0x1000` / `01:0C:CD:01:00:01` |
| Configuration revision | 3 |
| Configured MinTime / MaxTime | 20 ms / 1,000 ms |

GOOSE carries both asserted and clear states and retransmits the current
state. BRF01 checks the configured identity, dataset, revision, types,
quality, sequence and time allowed to live. Non-good or expired protection
input is not a fresh clear permissive. If PRF01's current becomes invalid,
its trip quality is invalid even if the internal trip latch remains asserted.
Configured intervals are not measured transfer times or timing guarantees.

### Measurement profiles

| Profile | Selection | Implemented input and limitations |
|---|---|---|
| Base | `compose.yaml` | SIMF01 phase-A RMS current over plant MMS. |
| Direct HTTP | Add `compose.http-input.yaml` | The browser posts `{"currentA": number}` to the station's same-origin route. The station forwards 0–1200 A to PRF01's wrapper, which validates it and returns the native relay's acknowledgment. The browser renews the input after Apply. After 3 seconds without updates, the input becomes invalid without an MMS fallback. |
| Experimental SV | Add `compose.sv.yaml` | MUF01 publishes synthetic SV and PRF01 derives phase-A RMS. The default 400 samples/s profile is unsynchronized and subject to observed sample skips; see [ADR 0028](adr/0028-sampled-values-training-profile.md) and [SV evidence](../outputs/sv-validation-report.md). |

HTTP is not SV, MMS or an IEC 61850 process-bus interface. It does not inject
phase B/C, voltage or fault state. The slider sequence uses 120 → 250 →
120 A; 250 A is above the *default* pickup, not necessarily a customized one.
Input validation and lease behavior are covered by
[`http-process-input-smoke.mjs`](../containers/http-process-input-smoke.mjs).

### Station and remote points

| Signal | Source | HMI / supervisory mapping |
|---|---|---|
| Breaker position | BRF01 `XCBR1.Pos`, derived from SIMF01 52a/52b | MMS; IEC 104 CA 1 IOA 100 double point; DNP3 double-bit index 0 |
| Protection trip | PRF01 `PTRC1.Tr.general` and quality | MMS; IEC 104 IOA 101; DNP3 binary index 0 |
| Phase-A current | PRF01 `MMXU1.A.phsA`, A RMS | MMS; IEC 104 IOA 102; DNP3 analog index 0 |
| Breaker operation failure | BRF01 `GGIO1.Ind1` | MMS; IEC 104 IOA 103; DNP3 binary index 1 |
| Close-inhibit latch | BRF01 `GGIO1.Ind2` | MMS; IEC 104 IOA 104; DNP3 binary index 2 |

The station HMI's OPEN/CLOSE and BRF01 latch reset use MMS; position
confirmation comes from a separate contact-derived read. The training
IEC 104 path supports monitoring and simulated select/execute switching;
DNP3 switching is not implemented. IEC 104 control is not production
authorization, independent interoperability or a conformance claim. See
[ADR 0029](adr/0029-remote-switching-boundary.md). Quality and
timestamps are carried with limitations: gateways collapse MMS quality to
their supported good/invalid representations. The station and distributed
gateways poll, so this is not evidence of lossless event recording.

## Networks, pages and capture

Compose separates `station` (MMS and GOOSE), `process` (plant MMS and
optional SV), `supervisory` (IEC 104 and optional DNP3), and `management`
(browser interfaces). Published web ports bind to IPv4 host loopback.
Network membership, aliases and service configuration are defined in
[`compose.yaml`](../compose.yaml) and the selected overlays.

The HMI's `/lab-overview` links to the configured asset ports and shows
endpoint reachability from the HMI container. That check does not prove a
host port, protocol flow, healthy IED or successful breaker operation. The
overview is unavailable if the HMI is stopped. Planned or inactive assets
are distinguished from available service interfaces. The capture-enabled
overview uses a separately started, loopback-only host agent; see the
[capture runbook](container-bench.md#packet-capture-from-the-lab-overview)
for endpoint coverage, privileges and limitations. The existing running HMI
must be rebuilt and recreated to show the updated controls at its original
URL; the agent also serves the updated overview separately without that
interruption.

### Optional secure-access training

The separate `compose.secure-access.yaml` overlay provides an opt-in
container-to-container WireGuard VPN and an SSH jump host forwarding to the
IEC 104 gateway web endpoint. It is not started by the base Compose file,
does not accept an external VPN client, and does not restrict existing
loopback-published lab pages. SSH authentication, the fixed target and
session termination are demonstrable; MFA, approval, expiry and key
revocation are not implemented. The [training guide](training-secure-remote-access.md)
details setup, observation, credentials, verification and security limits.

The separate `compose.recovery.yaml` overlay is an opt-in exercise for a
disposable project. It reads a file-backed IEC 104 master connection setting;
an instructor can inject a wrong port and trainees can verify and restore an
approved configuration. The exercise verifies monitoring only; it does not
test control or restore historical data. See the [recovery exercise](training-resilience-recovery.md)
for hash trust, operational checks and RTO/RPO limitations.

For evidence, record the capture point and network namespace. A Windows host
loopback capture can show browser HTTP but does not automatically observe
traffic on Docker's internal Linux bridges. Capture GOOSE at the station
segment, plant MMS/SV at the process segment, and IEC 104/DNP3 at the
supervisory segment. MMS uses TCP; GOOSE and SV are Layer 2 Ethernet, so
do not infer them from an HTTP-only or reconstructed TCP capture. The
[GOOSE run sheet](../specs/001-feeder/p1-linux-run.md) and
[capture evidence](../outputs/live-protocol-validation.md) describe scope
and limitations.

## Deployment snapshot: 23 November 2026, 09:03 UTC

The `ss01-lab-overview` project was rebuilt from the repository Dockerfile
and recreated with the direct-HTTP overlay, DNP3 profile and its existing
loopback ports. All eight running services used `ss01-lab-overview:local`,
image ID
`sha256:52d14f49f22681b15ac13c78588dd677921121e362369bd19fc2ae3cea6cb2f5`.
The previous image was retained as
`ss01-lab-overview:rollback-20261123-1429`. IEC 104 supervised simulated
control was enabled at both gateway and control centre. The host capture
agent was restarted at `http://127.0.0.1:34090/lab-overview`.

The instructor reset and preflight passed: CLOSED contacts and breaker,
120 A, clear trip and latch with GOOD quality on station, IEC 104 and DNP3;
the revision 3 GOOSE stream and running image identities also passed. The
baseline remained good on a repeat check ten seconds later. It is not
persistent without the controlling station page renewing the three-second
input lease; closing, reloading or suspending that page can invalidate it.
The [pilot guide](training-direct-http-pilot.md) describes recovery and
class-time preflight. Control is a simulation, not production authorization.

## Earlier deployment snapshot: 23 November 2026

This is a point-in-time observation, not a promise that these containers
remain running. The independent project `ss01-lab-overview` was started with
the HTTP input overlay and DNP3 enabled. Its image was
`ss01-lab-overview:local`, ID
`sha256:d23e9c14a61dce4fd714d87f56ce2fa094ef02e4545b1fb95e4c1266ce4eb95d`.
It was assembled offline from the existing `ss01-bench:dev` runtime with the
current feeder binary rebuilt and the current application/web assets copied
in. It is not proof that every native binary was rebuilt from current source.

| Endpoint | Observed host address |
|---|---|
| Lab overview / station | `http://127.0.0.1:8080/lab-overview` / `http://127.0.0.1:8080/` |
| SIMF01 / PRF01 / BRF01 | `127.0.0.1:33081` / `:33082` / `:33083` |
| IEC 104 gateway / centre | `127.0.0.1:33084` / `:33085` |
| DNP3 gateway / centre | `127.0.0.1:33086` / `:33087` |

Those pages returned HTTP 200 in the read-only check. MUF01 and Kali were not
started. The older `ss01-bench-control-centre-1` remained separately running
on port 8085; its presence does not indicate that the rest of that older
project is running. The project-specific image override and port environment
file were created in the Copilot session folder, not as repository deployment
configuration. Use `docker ps` and `docker inspect` for current state. For a
reproducible fresh deployment, follow the [container runbook](container-bench.md)
with a unique project and free ports; rebuild from source and obtain operator
approval before recreating any existing bench.

## Evidence and open boundaries

- The isolated HTTP test checked origin/payload validation, injected current,
  GOOSE trip, BRF01 MMS OPEN feedback, latched trip and input expiry. The
  overview was tested in isolated MMS, HTTP and SV configurations, including
  custom ports and a browser navigation check. These are project-peer smoke
  tests, not independent conformance tests.
- Earlier wire captures and GOOSE recovery tests are documented in the
  [GOOSE trip-cycle report](../outputs/goose-trip-cycle-report.md). Earlier
  SV tests observed sample discontinuities; their limits remain open.
- Formal SCL/profile validation, independent peer interoperability, complete
  loss/restart cases, bounded end-to-end timing, clock synchronization,
  protocol security and remote control remain acceptance work. Consult the
  [IEC 61850 checklist](iec61850-implementation-checklist.md) and
  [device-profile release criteria](../specs/001-feeder/protocol-profiles.md).
