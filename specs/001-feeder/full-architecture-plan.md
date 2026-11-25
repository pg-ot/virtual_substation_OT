# Complete substation implementation plan

The [low-level design](low-level-design.md) specifies service interfaces, point assignments, state machines, protocol behavior and acceptance vectors. It identifies which settings are implemented and which are proposed for the distributed release.

This is a target plan, and its starting-point and milestone statements are
historical. For current implemented capabilities and a dated deployment
snapshot, consult the [as-built reference](../../docs/as-built.md).

The [F01 cause-and-effect matrix](cause-effect.md) defines the protection and control decisions. The [P1 live Linux run sheet](p1-linux-run.md) ties those decisions to the first GOOSE and MMS position feedback gate.

## Scope and release outcome

Build one complete 11 kV outgoing feeder F01 in fictional station SS-01, with a 33/11 kV source and a 50 Hz process model. Match the station, bay and process levels of the reference drawing. Keep the source transformer and incomer as electrical context. The active equipment is feeder breaker 52-F01, its measurements, and its control and protection devices.

Use the integrated open-source repository as the baseline. Keep the independent processes and original industrial browser consoles. A dedicated engineering station is excluded. SCL, device profiles, point maps and startup configuration belong in versioned project files. Run the services directly on a Linux lab host first. Docker Compose packaging follows native acceptance.

## Reference diagram crosswalk

| Box | Reference role | Target and starting point |
|---|---|---|
| 01 | Control centre | Extend the verified IEC 104 and DNP3 monitoring clients with retained telemetry, connection state, controls and a live SCADA view. |
| 02 | Operation station | Connect the existing single-line and events UI to an independent native MMS client. The protection console already reads MMS. |
| 03 | Engineering station | Excluded. Check in CID and station configuration files, plus generation and validation commands. |
| 04 | Gateway | Extend the existing MMS-to-IEC 104 and alternate DNP3 paths. Read position from BRF01 and protection indications from PR-F01. Publish explicit point maps and support confirmed supervisory control. |
| 05 | GPS clock | Add a simulated station time source and time quality. Evaluate the power-utility PTP profile for the synchronized SV configuration. |
| 06 | Station bus | Native MMS and GOOSE on an isolated station network with separate device processes. Isolated Ethernet trip/capture exercises have since been performed; complete timing and independent interoperability remain open. |
| 07 | Protection | PR-F01 consumes the selected SV stream, evaluates a declared phase-overcurrent function and publishes trip over GOOSE. |
| 08 | Control | BRF01 receives the trip, drives process I/O and reports confirmed XCBR position. Its independent position and latch are bench-tested over MMS. |
| 09 | Protection + Control | Keep the combined IED as an alternate standalone baseline. The distributed F01 exercise uses boxes 07 and 08. |
| 10 | Process bus | Add a separate isolated Ethernet segment carrying native Sampled Values and breaker I/O traffic in the declared profile. |
| 11, 14 | Analogue merging unit and conventional CT/VT | Model conventional CT/VT signals and expose one standalone MU publisher for the primary exercise. |
| 12, 15 | Digital merging unit and electronic CT/VT | Model a separate digital-source configuration as a second process-input variant. Commission one source at a time for F01. |
| 13 | Breaker process I/O | Add independent simulated trip/close input and auxiliary contact feedback. Choose and document the process I/O mapping before enabling control. |
| 16 | Circuit breaker | Move simulated equipment position into the feeder process. BRF01 derives confirmed position from returned auxiliary contacts. |

The two measurement paths are proposed as alternative configurations of the same bay. The combined IED remains a selectable baseline. This keeps each reference role identifiable and gives the distributed bay one selected measurement stream and one authoritative breaker.

## Data and control ownership

```text
CT/VT model → selected merging unit ── SV ──→ PR-F01 protection
PR-F01 ── station GOOSE trip ──→ BRF01 control ──→ breaker process I/O
Virtual breaker ── auxiliary contacts ──→ BRF01 ── MMS ──→ HMI and gateway
PR-F01 ── MMS protection events ──→ HMI and gateway
Gateway ── IEC 104 or DNP3 ──→ control-centre client
```

- **Process model owns electrical truth.** Generate phase currents and voltages, bus energization, simulated fault conditions and breaker contact feedback. The instructor supplies scenario inputs. The switchyard renders confirmed state.
- **Protection IED owns the decision.** Use one declared overcurrent function for the first release. Publish pickup, operate/trip and time/quality independently. Record how invalid, missing or unsynchronized input affects this function. The process-level acceptance run must obtain its protection measurements from native SV.
- **Breaker control owns the control decision.** Consume validated trip and operational commands. Expose position, local/remote authority, close permissive and latched close block. Process feedback confirms movement independently of acceptance and termination. Trips take priority. Fault clearance and reset leave the breaker open until a separate authorized close.
- **Station and control centre own separate received views.** The station HMI and gateway each use station-side MMS. The control centre uses only its selected native supervisory client. Preserve source timestamp, quality and units where the protocol can carry them. Record any conversion or degradation in the point map.
- **Lab time service owns time status.** Preserve UTC source time and synchronization status independently of receive time. Use monotonic time for simulation intervals and link expiry. Verify an IEC/IEEE 61850-9-3 profile before making any timing-class claim. [IEC/IEEE 61850-9-3](https://webstore.iec.ch/en/publication/24998)

## Build sequence

| Phase | Build and dependency | Exit test |
|---|---|---|
| **P0 · Profile and test baseline** | Pin role-specific protocol editions and supported services. Create a signal register, SCL inventory, commissioning configuration, reference host and independent peers. Preserve current native and offline smoke tests. | Profiles have explicit IDs, versions, point owners, expected values and observable acceptance criteria. Existing smoke tests pass. |
| **P1 · Distributed breaker handoff** | Extend BRF01 configuration and verify PR-F01 → BRF01 live GOOSE on isolated Linux. Route confirmed breaker position to the station and gateway from BRF01. Depend on P0 role and address allocation. | Pass CE-01 through CE-06 using the run sheet. Record a station-network interruption case, one open request under retransmission, fresh reset and restart behavior, and BRF01 source identity at both consumers. GOOSE remains configured at both IEDs. |
| **P2 · Process equipment and I/O** | Separate C++ feeder and breaker plant state. Add CT/VT measurements, process-side breaker control, auxiliary contacts and independent reset. Wire the yard to confirmed feedback. Depend on P1 verified ownership. | Pass CE-07 and CE-08. Verify trip-over-close during travel and distinguish no travel, mid-travel stall and invalid contacts. A feeder trip leaves the source bus energized and reduces feeder current to zero. |
| **P3 · Process bus and time** | Add station clock behavior, conventional-input MU, electronic measurement variant, and native SV subscriber in PR-F01. Pin the stream layout, scaling, quality, sampling rate and sync expectations before implementation. IEC 61850-9-2 supplies the wire mapping and IEC 61869-9 informs the digital instrument-transformer profile. PTP and SV can be developed in parallel after P0, with P2 data required for the joint test. | Capture and decode each configured stream and match decoded measurements to the process model. Verify sample progression, time quality and recovery after input loss. In an isolated run, a real SV-fed protection pickup leads to a real GOOSE trip and confirmed breaker movement. [IEC 61850-9-2](https://webstore.iec.ch/en/publication/66549) · [IEC 61869-9](https://webstore.iec.ch/en/publication/24663) |
| **P4 · Native operator workflow** | Connect the industrial station HMI, protection and breaker faceplates, gateway diagnostics, event history and switchyard to the active services. Complete IEC 104 control-centre stale/reconnect state and command confirmation. Apply equivalent acceptance to the DNP3 alternate with its own device profile. Start view work after P1. Complete outage and control checks with P2/P3 active. | Complete the classroom acceptance runs below from the actual operator and instructor views. Confirm the station remains live while the control centre uses its last good sample. |
| **P5 · Independent acceptance and delivery** | Run applicable protocol test cases against independent implementations. Record supported options, exclusions, license obligations, hardware/time constraints and captures. Package the accepted process topology in Compose afterward. | Recreate a full run from documented configuration and one startup sequence. Publish build and profile versions and retain test logs and packet evidence. Record certification separately if obtained. |

## Classroom acceptance runs

| Run | Observable pass condition |
|---|---|
| Normal service | Station and control centre see CLOSED, three-phase feeder current and energized bus voltage. Each display can identify source and quality. |
| WAN loss only | Control-centre indications retain source timestamps and become stale. Station data and protection remain live. Supervisory controls are blocked. |
| WAN loss plus feeder fault | Native SV measurement drives protection → native GOOSE reaches BRF01 → process contacts confirm OPEN. Feeder current falls to zero and bus voltage remains present. Control centre retains CLOSED · STALE until reconnect. |
| Recovery | A fresh interrogation or integrity exchange refreshes the control centre. A pre-outage request is never replayed. Clear, reset and separate authorized close complete the sequence. |
| Signal and process failures | Verify lost SV input, expired GOOSE and missing breaker feedback separately. Confirm alarms and quality reflect the failed link. A lost stream or a transport acknowledgement alone never causes a close or a false position confirmation. |

## Evidence for completion

Archive a versioned signal register, generated model and source CID/SCL, IEC 104 interoperability list, DNP3 Device Profile, approved timing budget, native process startup instructions, same-library regression results, independent-peer results, and an event timeline with correlated packet captures. Check every declared role against the [device profile release criteria](protocol-profiles.md). Track release work in [tasks.md](tasks.md) and durable decisions in the [ADR index](../../docs/adr/README.md).

**Immediate milestone:** P1. BRF01 already has independent state and native MMS feedback in the bench. A successful isolated Linux run should link real GOOSE receipt to the BRF01 event and make BRF01 the position source of both station and supervisory views.
