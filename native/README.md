# Native protocol device build

The native device programs run separately and use protocol libraries. In the distributed process profile, SIMF01 supplies simulated electrical values, PRF01 owns the protection trip, and BRF01 owns breaker control and feedback. The IEC 104 gateway and DNP3 outstation are separate MMS clients. The earlier combined-device bench remains available for its regression exercises below.

## Build

Use a C/C++17 toolchain, CMake 3.24 or later, a build tool and an OpenJDK runtime. CMake fetches version-pinned sources and validates their archive hashes. The libIEC61850 model generator compiles `feeder.cid` into the IED model used by the server and peer. For CMake 4, pass the policy compatibility option shown below for the upstream projects.

```text
cmake -S native -B build-native -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build build-native --parallel
node native/smoke.mjs build-native --dnp3
```

For a multi-configuration generator, build with `--config Release` and point the smoke script at the directory containing the executables. Use `-DLAB_DNP3=OFF` and omit `--dnp3` for an IEC-only build. Keep the development interfaces on loopback. Run Layer 2 testing only on the isolated station interface on Linux, with permissions for raw Ethernet. The default Windows build excludes Layer 2 GOOSE.

To run a second test instance or avoid a local port collision, set `LAB_MMS_PORT`, `LAB_IEC104_PORT` or `LAB_DNP3_PORT` in the environment shared by the participating native processes. Defaults are 8102, 2404 and 20000 respectively.

IEC 104 CP56Time2a timestamps use UTC unless both gateway and master are
configured with the same Linux IANA timezone in `LAB_IEC104_TIMEZONE`.
External peers must use the same convention because CP56Time2a carries no
timezone. The DNP3 master responds to time requests using LAN time
synchronization and its system clock; this is not external clock discipline.

## First exercise

Run each program in its own terminal. Start `feeder-ied`, then run `station-client read` or `station-client watch` for native unbuffered reports. Start `telecontrol104 gateway` and `telecontrol104 master watch` to see the initial general interrogation and spontaneous updates. The DNP3 alternative uses `telecontrol-dnp3 outstation` and `telecontrol-dnp3 master`. Enter `fault` at the IED terminal to trip the breaker. Enter `clear` and verify `station-client close` is rejected while the latch is set. Enter `reset` before retrying the close. Keep the IED's stdin open while it is running.

Run `station-client goose-config` to read the advertised dataset, revision, APPID and timing over MMS. For GOOSE frame reception, run `feeder-ied <isolated-interface>` and `goose-peer <isolated-interface>` with Layer 2 support enabled. The subscriber filters by the generated control block reference, APPID and destination MAC, checks the dataset and configuration revision, and reports expiry of the received stream.

| Interface | First implementation |
|---|---|
| MMS TCP 8102 | PRF01LD0. XCBR1.Pos (DPC), PTRC1.Tr (ACT), MMXU1.A.phsA (CMV). Reads include quality and timestamps. Breaker control uses direct control with enhanced security and a protection interlock. A bay status unbuffered report control block is defined. |
| GOOSE | PRF01LD0/LLN0$GO$Protection. APPID 0x1000, destination 01:0C:CD:01:00:01, ConfRev 3. The dataset carries `PTRC1.Tr.general` and `PTRC1.Tr.q`. |
| IEC 104 TCP 2404 | CA 1. IOA 100 double-point position, 101 single-point trip, 102 short-float current in amperes, 103 operation failure and 104 close-inhibit latch. General interrogation uses untimed objects. Spontaneous updates use CP56Time2a. |
| DNP3 TCP 20000 | Link addresses master 1 and outstation 10. Breaker double-bit and trip binary on index 0 in their respective type families, operation failure binary index 1 and close-inhibit binary index 2 use Class 1 events. Current analog index 0 uses Class 2. The master polls integrity and event classes. |

## Distributed breaker exercise

Set `LAB_DISTRIBUTED=1` in the environment of every participating device and client. Start `feeder-ied <isolated-interface>` and `breaker-ied <isolated-interface>` on an isolated Linux station segment. On hosts without Layer 2 support, start `feeder-ied` and `breaker-ied --bench` to use stdin-injected protection inputs. Keep both input streams open.

| Step | Terminal and command |
|---|---|
| Reconcile the initial contacts | BRF01 `feedback-closed` or `feedback-open`, matching the fixture |
| Check both IEDs | `station-client read` or `station-client watch` |
| Apply a fault | PRF01 `fault`. For a bench delivery test, send BRF01 `trip` separately. |
| Clear the fixture and release the protection output | PRF01 `clear`, then PRF01 `reset`, then BRF01 `fault-cleared` once the fixture confirms clearance |
| Reset the lockout | BRF01 `reset` with confirmed OPEN and a fresh deasserted trip. Use `healthy` first in bench mode. |
| Close separately | BRF01 `close` with the same prerequisites and a reset latch |

The bench `trip` and `healthy` inputs expire after three seconds. `stale` expires the input immediately. BRF01 restarts with unknown contacts and close inhibited. Supply the pre-restart fixture position to reconcile, then re-establish clearance as appropriate. A trip received while contacts are unknown remains pending until the fixture reports contact state.

The [distributed smoke](distributed-smoke.mjs) exercises the negative control, injected delivery, repeated trips, reset and close guards, and restart reconciliation. Run `node native/distributed-smoke.mjs build-native --dnp3`. It uses native MMS, IEC 104 and DNP3 on TCP. The isolated Ethernet acceptance sequence is in the [P1 Linux run sheet](../specs/001-feeder/p1-linux-run.md).

In distributed mode, the station CLI, IEC 104 gateway and DNP3 outstation take position, source time and quality from BRF01 MMS. Position is UNKNOWN/invalid when feedback is unavailable. PRF01 supplies trip and synthetic test current. The P1 bench uses injected normal/fault current levels. The independent process profile below supplies current based on electrical continuity. The combined bench remains available with the profile variable unset. BRF01 MMS listens on port 8103 by default. Override with `LAB_BREAKER_MMS_PORT`.

### Training protection settings

The process-fed PRF01 pickup uses `LAB_PROTECTION_PICKUP_A` (finite positive
amperes, default `200`) and `LAB_PROTECTION_DELAY_MS` (integer milliseconds
from `0` to `4294967295`, default `0`). Invalid settings prevent startup.
The settings are read and logged at startup; changing them requires restarting
PRF01. Compose passes both variables to the protection service. The default
preserves the original 200 A, no intentional delay behavior.
Run `protection-settings-regression` from a build containing that target and
`node native/protection-settings-smoke.mjs <build-directory>` to exercise the
settings against an isolated local process simulator; the smoke test injects
and clears a simulated fault and must not be pointed at a live process.

The delay starts on the first observed current at or above pickup and resets
on a below-pickup or unavailable reading; the trip remains latched once
asserted. The MMS process worker reads approximately every 50 ms. With SV
selected, a separate worker reads the SV receiver approximately every 5 ms,
without waiting for each MMS request. SV is still gated on the most recent
plant read succeeding; a failed read invalidates the process current. Neither
period is a hard deadline. The delay is based on observed values, cannot
establish uninterrupted overcurrent between reads, and is not a precise or
certified relay operating time. Local non-process fault injection remains a
separate bench fixture and does not use these settings. This configuration is
for training, not field protection.

For isolated GOOSE timing experiments, `LAB_GOOSE_TIMING=1` enables
monotonic-nanosecond diagnostics at a PRF01 trip-value update and at the
subscriber immediately before the input callback. Compare them only when
both processes share the same monotonic clock, as containers on one Linux
kernel do. These logs perturb execution, omit measurement uncertainty, and
do not establish a real-time guarantee or standards conformance.

## Release boundary

IEC 104 and DNP3 paths cover monitoring and have browser views. The training IEC 104 path also supports simulated select/execute switching; DNP3 switching, independent supervisory control acceptance and full client state persistence remain open. See [ADR 0029](../docs/adr/0029-remote-switching-boundary.md). The development CID supplies the working model. Complete device profiles, independent validation of the SCL and independent-peer conformance testing are separate release tasks. Same-library smoke checks verify that these programs exchange native traffic and that the feeder scenario reaches their clients.

The station single-line is available with `node src/serve.mjs --native build-native` from the repository root. Isolated Linux GOOSE wire and distributed MMS control exercises have been performed; complete timing, independent interoperability, report coverage and acceptance remain open. See the [as-built reference](../docs/as-built.md) and the [GOOSE evidence](../outputs/goose-trip-cycle-report.md).

## Independent process simulator

Set `LAB_DISTRIBUTED=1` and `LAB_PROCESS_MODEL=1` for BRF01 and PRF01. Start `plant-ied`, `feeder-ied`, and `breaker-ied --bench` in separate terminals using the same port configuration. `LAB_PLANT_MMS_PORT` overrides the plant's loopback port of 8104. The plant owns breaker contacts and the synthetic electrical state. The IEDs are independent plant MMS clients.

| Exercise | Commands and readback |
|---|---|
| Baseline | Run `plant-read` for 52a/52b, fault state, 11 kV source voltage and feeder current. Run `station-client read` for BRF01 position and PRF01 trip/current. |
| Successful trip | Send `fault` to the plant. Check PRF01 asserts while feedback is CLOSED. Send `trip` to BRF01 to inject delivery on the Windows bench. BRF01 reports intermediate, then OPEN from the contacts. Current goes to zero while the fault and upstream voltage remain present. |
| Explicit reset and close | Send `clear` to the plant. After PRF01 logs `Process fault cleared`, send `reset` to PRF01. Give BRF01 fresh deasserted input with `healthy` on the bench, then use BRF01 `reset` and `close` as separate commands. |
| No travel | Select `stuck` at the plant before applying the fault and delivering the trip. After the movement deadline, `breaker-read` with the process profile shows CLOSED and `operation_failure=1`. |
| Feedback faults | `stall` enables mid-travel stall, and `contacts-invalid` forces both contacts asserted. `normal` repairs the simulated contacts and mechanism, leaving the actual simulated position in place. |

`plant-ied` models 300 ms travel and BRF01 uses a 950 ms movement deadline. These values define the training fixture. Start a fresh process to start a new fixture with the breaker closed. Observe the operation failure through BRF01's native readback or device console. The station single-line already uses the plant-fed current through PRF01 MMS.

Run `node native/process-smoke.mjs build-native` to exercise both opening outcomes, trip during close, stalled travel, contradictory contacts and loss of feedback. This test uses MMS and injected trip delivery. The process MMS adapter is the local simulator interface. Process-bus GOOSE, Sampled Values and live station GOOSE retain their separate acceptance gates.
