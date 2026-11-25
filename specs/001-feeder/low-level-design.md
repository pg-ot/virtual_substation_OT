# Low-level implementation design for SS-01 / F01

Use this target design with the [full architecture plan](full-architecture-plan.md). For current implementation and mappings, use the [as-built reference](../../docs/as-built.md); proposed points below are not deployed mappings. Numeric values marked **proposed** are test fixtures and acceptance budgets for this fictional bay.

## 1. Runtime and configuration

| Service | Reuse and planned change | Input → output |
|---|---|---|
| Plant / breaker process I/O | Extract the synthetic electrical and breaker state into a standalone C++ process. Begin with one plant and one I/O adapter. | Scenario input and interlocked breaker action → waveform source, auxiliary contacts and movement result. |
| MU-A / MU-D | Add a native Sampled Values publisher. Select one configured source at startup. Keep both variants selectable. | Plant measurements and clock status → configured SV stream on the process bus. |
| PR-F01 | Refactor `native/feeder_ied.cpp` and reuse `native/feeder.cid` as the starting model. Keep the current combined IED available as a bench mode. | SV stream → overcurrent pickup/operate, station GOOSE trip, MMS measurements and protection events. |
| BRF01 | Extend `native/breaker_ied.cpp` and the receiver in `native/goose_peer.cpp`. Replace the dynamic MMS model with generated BRF01 CID for the distributed release. | Validated GOOSE trip and authorized MMS commands → process I/O. Returned contacts → MMS position and quality. |
| Station MMS consumer | Extend `native/mms.cpp` and `native/station_client.cpp` for multiple associations and configured report subscriptions. | BRF01 and PR-F01 → station read model, event history and control acknowledgements. |
| GW-01 | Reuse `native/telecontrol104.cpp` and `native/telecontrol_dnp3.cpp`. Share a point model and command adapter across the two supervisory variants. | Independent MMS client → native IEC 104 controlled station or DNP3 outstation. |
| CC-01 | Extend the native master programs with persistent connection state, snapshots and controls. | IEC 104 or DNP3 → control-centre read model and command status. |
| Device and operator views | Reuse `src/native-device-console.mjs`, `web/native-device.html`, and the existing single-line and yard UI. | Service snapshots and events → browser readouts and validated operator or instructor requests. |

Use one deployment configuration for service endpoints, station and process interfaces, active MU, supervisory flavor and schema version. Provide distinct **bench** and **distributed** configurations. Start the time and plant services, process I/O and the selected MU, then BRF01 and PR-F01, then the station clients and gateway, then CC-01. Each service reports its own readiness, input quality and reason for degradation. Readiness does not assume a value exists just because a socket opened.

In the native Linux deployment, use separate station, process and supervisory networks. Put PR-F01 and BRF01 on the station network and their process-side adapters on the process network. Connect GW-01 to the station and supervisory networks. Attach CC-01 to the supervisory network. Keep browser endpoints on a local management path. The WAN scenario only interrupts the supervisory conduit. Process-bus timing runs on an isolated reference host before Compose packaging. Loopback bench defaults already used are PR-F01 MMS 8102, BRF01 MMS 8103, IEC 104 TCP 2404 and DNP3 TCP 20000. Assign distributed bind/peer addresses through configuration.

## 2. Station model and point register

Use stable semantic point IDs in the application. Generate the IEC 61850 device model from versioned SCL and validate that the configured datasets, report control blocks, references, and subscriptions match the built endpoints. Use separate manifests for protocol-specific mappings and validate duplicate addresses and point types at startup. [IEC 61850-6 SCL scope](https://webstore.iec.ch/en/iec_catalog/product/preview/?id=L3B1Yi9wZGYvcHJldmlldy9pbmZvX2llYzYxODUwLTZ7ZWQyLjJ9ZW4ucGRm)

| Point | Authoritative source and representation | IEC 104 CA 1 | DNP3 point |
|---|---|---:|---|
| `breaker.position` | BRF01 `XCBR1.Pos` from two process contacts. Double point. | IOA 100, existing | Double-bit 0, existing |
| `protection.trip` | PR-F01 trip output. Separate this from the current combined trip/latch before switching the distributed profile. | IOA 101, existing position in map | Binary 0, existing position in map |
| `current.a` | PR-F01 `MMXU1.A.phsA`, A RMS. | IOA 102, existing | Analog 0, existing |
| `current.b`, `current.c` | PR-F01 phase B/C, A RMS. | 103, 104 proposed | Analog 1, 2 proposed |
| `bus.voltage.ab`, `.bc`, `.ca` | Source bus line-to-line voltage, kV RMS. Prefer a clearly named bus measurement data object. | 105–107 proposed | Analog 3–5 proposed |
| `frequency.hz` | Frequency calculated from the selected measurement source. | 108 proposed | Analog 6 proposed |
| `protection.pickup` | PR-F01 overcurrent start. | 109 proposed | Binary 1 proposed |
| `breaker.close_block` | BRF01 latched close interlock. | 110 proposed | Binary 2 proposed |
| `breaker.remote` | BRF01 operator authority indication. | 111 proposed | Binary 3 proposed |
| `breaker.close_permissive` | BRF01 aggregate of valid inputs, authority, latch and process interlocks for the applicable source. | 112 proposed | Binary 4 proposed |
| `breaker.command` | Separate operation object. BRF01 owns the result and reports confirmed position independently. | 120 proposed control IOA | Control index 0 proposed |

Document exact logical nodes and reason codes when engineering each model. Preserve the existing IEC 104 double/single/float status types and timed spontaneous forms where already verified. For DNP3 preserve master/outstation addresses 1/10, Class 1 status events and Class 2 analog events, and explicitly declare the group/variation, event buffering, overflow and control behavior. Record those declarations in the Device Profile. [DNP Users Group conformance policy](https://www.dnp.org/Products/Testing-Policy)

Use a shared station sample shape conceptually equivalent to:

```text
PointSample { point_id, value, unit, quality, source_time_ms?, received_time_ms,
              source_device, source_session, sequence }
Command { operation_id, target, action, origin, issued_at, deadline, session_epoch }
CommandResult { operation_id, phase, result, reason, confirmed_position?, source_time_ms? }
```

Keep original protocol quality flags alongside the normalized quality. Use `UNKNOWN` before the first valid value, `LIVE` for current usable data, `INVALID` for a source-reported invalid measurement, and `STALE` for previously usable data whose connection or freshness expired. Retain original source time. Show receive time independently, especially for untimed IEC 104 interrogation data or messages without source timestamps. Track session epoch and sequence to discard older delayed updates. Do not overwrite a last-good timestamp with the time of failure.

## 3. Process and breaker state

**Process state.** Maintain source energization, load, fault type and phase, breaker mechanism state and both contacts. Initial proposed fixture: energized source, 11 kV line-to-line RMS, 50 Hz, 120 A per phase, breaker closed. The faulted fixture increases current on the selected phase to a proposed 600 A RMS until the breaker opens. After opening, feeder current falls to zero while source-side voltage remains present. Define waveform phase relationship, units, scaling and clipping centrally. Virtual time controls waveform generation; wall-clock adjustments cannot change timers.

**Breaker state and confirmation.** Use the contact mapping below. During a commanded movement, publish the measured intermediate state once contacts change. After the movement deadline, retain measured feedback and raise an explicit failed-confirmation alarm.

| 52a | 52b | Interpretation |
|---|---|---|
| 0 | 1 | OPEN |
| 1 | 0 | CLOSED |
| 0 | 0 | INTERMEDIATE while moving, then indeterminate/invalid if the deadline expires |
| 1 | 1 | Contradictory contacts, invalid feedback |

For local process operations, use explicit request IDs, a target and a deadline. Serialize state transitions in the process owner. Use an independent feedback message or read and confirm only the expected contact result. A proposed simulated travel time is 80 ms and feedback deadline 500 ms. Pin the actual classroom limits after measuring the reference host.

For HMI and supervisory control, pass a fixed action, one origin and the active session epoch. Check connection freshness, authority, required select/operate state, quality, close block and process availability on the server. Return acceptance or rejection first, with a separate outcome once feedback resolves. A trip supersedes pending or accepted close, including while the mechanism is moving. The process actuator is the final arbiter. Do not carry pending commands across reconnect, process restart or reset. Reject duplicate or expired requests without operating twice. Reset requires explicit fault clearance, fresh deasserted protection, usable OPEN feedback and authorized local action. Reclose is a separate authorized action. Use the [cause-and-effect matrix](cause-effect.md) for interlock and restart rules.

## 4. GOOSE, Sampled Values and time

- **Station GOOSE.** The current CID has `PRF01LD0/LLN0$GO$Protection`, APPID `0x1000`, MAC `01:0C:CD:01:00:01`, ConfRev 3, and configured 20/1000 ms minimum/maximum times. PRF01 publishes its protection trip and quality. Revise the dataset and increment its configuration revision when the contract changes. Generate publisher and subscriber references from the same SCL. Receiver checks identity, dataset and types, revision and freshness. Treat repeated same-state frames as retransmissions. Preserve one operation per valid trip assertion; report `stNum`, `sqNum`, last receipt, and expiry independently. Additional wire expiry and restart cases remain acceptance work.
- **Process I/O.** Reserve a separate configured binding from BRF01 to breaker process I/O and a distinct contact feedback binding. Use a local typed interprocess adapter for P2 bench verification. Select and verify the final process-bus mapping in P3, including its feedback, validity, restart and acknowledgment semantics. Keep the bench adapter explicitly labeled.
- **Native SV.** Choose the edition and sampling profile during P0. Specify the destination address, APPID, VLAN, stream ID, revision, sample rate, ordering, ASDU packing, sample count wrap, encoding scale and per-channel quality before implementation. Provision a distinct stream ID for each MU variant and verify that PR-F01 accepts only the commissioned input. Use the selected verified profile to map three-phase current and voltage channels and any residual channels it requires. Measure missed and reordered samples and mark a window invalid when the declared continuity rule fails. [IEC 61850-9-2](https://webstore.iec.ch/en/publication/66549) · [IEC 61869-9](https://webstore.iec.ch/en/publication/24663)
- **Protection algorithm fixture.** Start with one simulated phase overcurrent element. A proposed bench vector uses one-cycle RMS at 50 Hz, 300 A pickup and a 100 ms definite delay. Record start after crossing, operate after the delay and release according to a declared dropout threshold and reset rule. Recover only after a full valid measurement window. Pin the missing-input response and the policy for time quality in the protection profile. Verify the measured end-to-end delay before publishing a lab budget.
- **Time source.** Expose clock state `SYNCED`, `HOLDOVER` or `UNSYNCED` with an offset or reason when available. Preserve source clock status through gateways where representable. Derive monotonic deadlines separately. Run and measure both synchronized and time-loss scenarios. Formal PTP timing claims require the selected profile and measurements. [IEC/IEEE 61850-9-3](https://webstore.iec.ch/en/publication/24998)

## 5. Stable operator state and test vectors

Each station-side client connects independently to the IEDs. Initialize its dataset after a successful read or report snapshot. The control-centre client moves through `DISCONNECTED → SYNCHRONIZING → LIVE`. A dropped connection retains the last good sample marked stale. Reconnect starts a new session epoch. IEC 104 uses data-transfer start and a completed configured interrogation. DNP3 uses its configured startup integrity exchange. Accept new controls only after the required current feedback has arrived. Monitor native transport and the data source separately so an open socket alone never implies healthy telemetry.

Use service snapshots for the single-line, 3D yard and faceplates. Include ordered events with source device, equipment point, operation ID, protocol, quality and both timestamps. Render confirmed position from BRF01 and currents from PR-F01. Commands submitted in the browser show pending/accepted/terminated independently. Run the full workflow with all browser windows closed and reopen the views to confirm that device state remains in the native services.

| ID | Injected condition | Assert |
|---|---|---|
| LL-01 | Execute CE-02 during an isolated station-network interruption and CE-03 after connectivity is restored. Keep GOOSE configured at both IEDs. | During interruption, CLOSED remains live at both consumers when their MMS paths remain available. After restoration, retransmissions result in one breaker open request and MMS reports BRF01 OPEN. |
| LL-02 | Execute CE-06. Expire GOOSE, then restart the publisher and BRF01 separately. | GOOSE quality transitions stale then live. No automatic close. Restart retains or conservatively reconciles lockout and position. A first fresh asserted trip is processed. |
| LL-03 | Accept open and simulate stuck mechanism. | No false OPEN. Movement timeout and unchanged contacts are visible. |
| LL-04 | Fault one phase in the SV fixture. | Valid SV causes pickup then trip, GOOSE receipt, process contact change and BRF01 OPEN. Zero feeder current and energized bus appear together. |
| LL-05 | Drop the WAN, then fault the feeder. | CC-01 retains CLOSED with its original timestamp and stale indication. Station remains live. Restoration refreshes OPEN before enabling control. |
| LL-06 | Disconnect after receiving a command but before feedback. | Outcome is unknown until reconciliation. Old requests do not execute automatically on reconnect. |
| LL-07 | Lose clock synchronization or the selected MU. | Distinct time-quality or stream-loss indications. The configured invalid-input behavior is observable and no close is caused by data loss. |
| LL-08 | Clear fault, reset latch and attempt close. | Reset alone preserves OPEN. An authorized, fresh close with valid permissives is followed by separate position confirmation. |

Keep P1 small. First produce live GOOSE capture evidence and a BRF01 MMS before/after trace. Next update the gateway and station MMS point adapters and assert their source identity. Then add feedback and command correlation in the plant interface. Attach packet logs, event logs, model/config versions, result and any untested cases to each completed phase.
