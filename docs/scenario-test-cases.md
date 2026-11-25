# SS-01 scenario test cases

These are simulation acceptance checks, not industrial protection or protocol
conformance tests. Run only on a disposable, uniquely named Compose project
with free loopback ports. Several tests trip and operate the breaker, disconnect
networks, stop containers, and append to instructor history. Never point them
at an active teaching session. Use the same Compose files, project name, profile
and port environment for setup, tests and cleanup. Enable DNP3 for cases that
require both masters; HTTP input requires its own separate fixture.

| ID | Setup and stimulus | Expected observation | Executable evidence |
|---|---|---|---|
| P01 | Plant MMS baseline; reset | Clear fault and trip, normal current, CLOSED contact feedback, clear failure/latch, both masters good | `scenario-faults-smoke.mjs`, baseline |
| P02 | HMI open then close | Each operation is separately contact-confirmed | `scenario-faults-smoke.mjs`, switching |
| P03 | Plant fault with closed breaker | PRF01 trips; BRF01 opens; HMI and both masters show trip and OPEN | `scenario-faults-smoke.mjs`, fault |
| P04 | Clear fault without relay reset | Trip remains latched; breaker remains OPEN | `scenario-faults-smoke.mjs`, latched clear |
| P05 | Reset, reset breaker latch and close | Clear trip and latch; return to contact-confirmed baseline | `scenario-faults-smoke.mjs`, reset |
| P06 | Stuck mechanism then fault | Trip asserted; breaker remains CLOSED; failure visible at HMI and both masters | `scenario-faults-smoke.mjs`, stuck |
| P07 | Stall mechanism then fault | No valid final position; operation failure; normal mode permits recovery | `scenario-faults-smoke.mjs`, stall |
| P08 | Contradictory 52a/52b contacts | Position quality invalid at HMI and masters; recovers in normal mode | `scenario-faults-smoke.mjs`, contradictory contacts |
| P09 | Trip while closing | Open supersedes close; no final CLOSED feedback | `native/process-smoke.mjs` |
| P10 | Lose plant input | Position and protection input quality become invalid | `native/process-smoke.mjs` |
| P11 | Disconnect PRF01 process network | Invalid-quality GOOSE, invalid current/trip; close rejected; restored input permits close | `goose-quality-smoke.mjs` |
| P12 | Stop/restart BRF01 and PRF01; start HMI during outage | Invalid indications on loss, good indications on recovery; expired protection permissive rejects close | `startup-recovery-smoke.mjs` |
| P13 | Stop/restart IEC 104 gateway | Remote loss and recovery; baseline reset | `instructor-smoke.mjs` |
| P14 | Apply the 1200 A plant fault with pickup set first to 1201 A, then to 1200 A with delay | No trip one amp below pickup. At exact pickup the relay trips after the configured delay, and clearing before expiry restarts the delay. | `native/protection-settings-smoke.mjs` |
| H01 | HTTP fixture; invalid origin, media type, malformed JSON, and invalid current values | Reject with 403, 415, 400, or 422 as appropriate. Direct writes at the protection port are refused. The 0 A lower limit succeeds through the station. | `http-process-input-smoke.mjs` |
| H02 | Apply 120 A, then 580 A, then 120 A | Good measured values, GOOSE trip and contact-confirmed OPEN. The trip remains latched. | `http-process-input-smoke.mjs` |
| H03 | Stop renewing HTTP input | Current quality becomes invalid after the lease | `http-process-input-smoke.mjs` |
| H04 | In HTTP mode apply the yard fault before sending relay current, then send 120 A | SIMF01 shows an active fault, 1200 A and CLOSED contacts. PRF01 goes from invalid to 120 A and clear trip. BRF01 stays CLOSED. | `http-process-input-smoke.mjs` |
| H05 | With SIMF01 fault clear, send 580 A to PRF01 | PRF01 reports 580 A and asserts trip. SIMF01 confirms OPEN contacts, 0 A and clear plant fault. | `http-process-input-smoke.mjs` |
| H06 | Apply 182 A from a second station tab. Attempt renewal of 120 A from the previous tab. | The previous tab loses control. With the default 200 A pickup, 182 A remains applied and the breaker stays closed. | `http-process-input-smoke.mjs` |
| H07 | Attempt close or reset at overcurrent, then restore 120 A | Close and reset are blocked during overcurrent. The outgoing CT measures zero while open. An explicit PRF01 reset clears the trip, a separate BRF01 reset clears the close latch, then close succeeds. | `http-process-input-smoke.mjs`, `web/station-ui-audit.test.mjs` |
| Y01 | Use the yard fault endpoint in plant MMS mode | PRF01 trips, BRF01 confirms OPEN, both masters report trip and OPEN, and the yard retains a live source bus with zero feeder current. | `scenario-faults-smoke.mjs` |
| Y02 | Repeat with stuck, stalled and contradictory contact fixtures | Stuck retains CLOSED and 1200 A. Stall shows both contacts off and no valid final position. Contradictory contacts show both on and invalid position. | `scenario-faults-smoke.mjs` |
| Y03 | Expire individual points and supply malformed readings | Stale fault and current disappear independently. Loss of contact data produces UNKNOWN position even with a valid current and fault. | `yard/tests/telemetry.test.mjs` |
| U01 | Lose the trip permissive while the close dialog is open | Execute and Close become disabled. | `web/station-ui-audit.test.mjs` |
| U02 | Let the direct HTTP sequence complete uninterrupted | The station sends 120 A, 250 A, then 120 A in order and restores the Apply control. | `web/station-ui-audit.test.mjs` |
| W01 | Capture isolated trip/clear and input loss at BRF01 | Decode correct GOOSE identity, revision and dataset, asserted/clear and invalid quality | `scenario-pcap-validation.mjs` |
| W02 | Capture station and supervisory traffic | Decode BRF01 MMS position/failure reads, IEC 104 IOAs 100–104, DNP3 binary/double-bit/analog objects | `scenario-pcap-validation.mjs` |
| W03 | Capture direct HTTP injection | Decode preflight and 120/1200 A POST bodies | `scenario-pcap-validation.mjs` |
| W04 | Measure observed GOOSE timing | Report intervals, TTL and anomalies without treating configured timing as a guarantee | `goose-capture-analysis.mjs <breaker.pcap> 20 1000` |
| C01 | Capture a single station interface | PCAP downloadable with GOOSE; reject foreign origins and concurrent capture | `capture-agent-smoke.mjs` |
| C02 | Capture supervisory network, then stop early | Per-interface captures and combined PCAPNG include decoded IEC 104 and DNP3 | `capture-agent-smoke.mjs` |
| C03 | Capture all project networks and make a fresh MMS association | Per-interface and combined captures produced; GOOSE, MMS, IEC 104 and DNP3 decoded at appropriate points | `capture-agent-smoke.mjs` |
| C04 | Restart capture agent | Most recent completed capture and download are restored from its manifest | Isolated restart and download check |
| R01 | Dedicated recovery overlay; change the master port, restart, verify and restore the approved configuration | Remote monitoring is lost and then returns with GOOD points; a hash mismatch must not change the active file | `recovery/exercise.test.mjs`, `recovery/scenario-smoke.mjs`; [recovery exercise](training-resilience-recovery.md) |

Scripts are under [`containers/`](../containers/) unless another directory is
specified. Run `node containers/scenario-pcap-validation.mjs <directory>` on
the five capture files named in the [run report](../outputs/scenario-validation-20261123/report.md);
the decoder uses the locally available `ss01-kali:dev` image. These assertions
are specific to that capture set. Functional tests and packet observations
complement one another: an MMS read request alone does not prove its response
or an end-to-end operation, and one endpoint capture does not prove every
packet on a switched network was observed.

## Remaining acceptance cases

- Reset rejection for every invalid or unsafe state, and pickup and delay
  combinations beyond H01, H02 and P14.
- Actual browser sequencer interaction, renewal under navigation or suspension,
  and HTTP reset while the plant is unavailable.
- GOOSE wrong APPID/dataset/revision, malformed payload, duplicates,
  out-of-order sequences, network partition and recovery with an independent
  publisher/subscriber; reverse position GOOSE is not implemented.
- DNP3 gateway/master loss and recovery; all point index, quality and timestamp
  combinations verified with an independent master. IEC 104 remote switching is
  experimental and not tested here; DNP3 switching is not implemented.
- SV continuity and quality under load, synchronized timing, interoperability,
  clock/packet-loss faults and engineered end-to-end timing. The experimental
  SV profile has known sample discontinuities; see the
  [SV report](../outputs/sv-validation-report.md).

Do not interpret the listed cases as exhaustive combinations or evidence of
standards certification.

## Yard and station UI audit

The 1200 A / CLOSED screenshot is reproducible from the HTTP profile data
in H04. In plant MMS mode a healthy breaker opens, as exercised by Y01.
The stuck-mechanism case in Y02 independently shows why a useful display
needs the relay trip and the breaker operation failure as separate indications.

All eight findings below are fixed in the workspace UI. The table records
the original behavior and the expected behavior tested after the fix.

| Finding | Original behavior | Acceptance check |
|---|---|---|
| AUD-01 | The yard PRF01 cabinet copied SIMF01's current and fault. Relay trip was hard-coded as NO DATA, and the bay cabinet lacked BRF01's operation-failure indication. | With 1200 A at SIMF01 and relay feedback missing, the PRF01 pane shows its input as unavailable or invalid. When relay and breaker feedback are available, verify live trip, confirmed position and operation failure independently. [Scene source](../yard/panel_room.gd) · [Scene test](../yard/tests/check_scene.gd) |
| AUD-02 | In the HTTP profile the yard and SIMF01 diagnostics still offer Inject overcurrent and tell the operator to reset protection afterward. The command acknowledgment only confirms a plant-side fault. The same command does not supply the configured relay input. | The plant control must describe its scope in HTTP mode and explain where relay injection occurs. H04 and Y01 exercise the same plant fault route with different profiles. [Yard](../web/yard/index.html) · [Diagnostics](../src/component-service.mjs) |
| AUD-03 | In a UI fixture, a stale trip with a retained true value reads UNKNOWN on the faceplate while the points table says ASSERTED and marks it as an alarm. The current station server clears invalid values, so this is a defensive UI check. | Stale retained data must not appear as a live active trip. |
| AUD-04 | The one-second renewal renews the previously applied current and resets the slider to that value, overwriting a draft edit. | Keep the draft slider value until Apply. |
| AUD-05 | Stop during an in-flight 250 A sequence update hits the request lock. The 120 A restore is never sent and renewal can continue at 250 A. | Acknowledge the pending request and finish Stop by sending 120 A. |
| AUD-06 | After station data shows PRF01 current invalid, the last input-control message can still say the lease is active. | Clear the active lease indication when feedback invalidates it. |
| AUD-07 | The station mimic labels the injected PRF01 reading CT-F01 PHASE A, including when 1200 A is sent directly while the plant feeder is open. | Identify the source of displayed current in direct HTTP mode. |
| AUD-08 | When an OPEN request fails before it reaches the server, the next state poll replaces the error with the previous CLOSE command's POSITION CONFIRMED. | Keep the current request outcome visible. A prior command result cannot confirm a new request. |

Run the station UI checks with `node --test web/station-ui-audit.test.mjs`.
They exercise station JavaScript with a DOM fixture, controlled time,
and stubbed HTTP responses. Run the cabinet checks with the pinned engine
using `godot --headless --path yard --script res://tests/check_scene.gd`.
The isolated MMS and HTTP smoke scripts exercise the yard's live indication
feed during faults and confirm the separation of plant and relay current.

On 25 November 2026, isolated plant MMS and HTTP projects passed these
functional fault scenarios first with the current JavaScript source mounted
over `ss01-lab-overview:local`, then with the native and web code rebuilt
from the workspace as `ss01-audit:local`. The native pickup and delay check
also passed in a separate container. Headless Godot 4.6.3 passed the
ordinary scene checks and reproduced AUD-01 with the audit flag. The
station JavaScript suite reproduced AUD-03 through AUD-08 before the fix.

After the fix, the station and yard JavaScript checks and the Godot scene
checks passed. The updated Web scene pack started in headless Godot.
The isolated HTTP run confirmed that SIMF01 can show 1200 A while PRF01 is
invalid and BRF01 is closed, then confirmed PRF01 current and trip with
BRF01 open after direct injection. The isolated plant-MMS run confirmed
fault trip, confirmed opening, stuck and stalled breaker feedback, and
contradictory contacts with the new indication feed.
