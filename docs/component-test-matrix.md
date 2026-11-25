# Component and propagation test matrix

The automated chain test starts separate device and protocol processes inside an isolated container. It does not operate the running substation. Run it from the project directory after building the image:

```powershell
docker compose build plant
docker run --rm --entrypoint node -v "${PWD}:/repo:ro" -w /repo ss01-bench:dev native/chain-smoke.mjs /usr/local/bin
docker run --rm --entrypoint node -v "${PWD}:/repo:ro" -w /repo ss01-bench:dev native/station-control-smoke.mjs /usr/local/bin
docker run --rm --entrypoint node -v "${PWD}:/repo:ro" -w /repo ss01-bench:dev native/process-smoke.mjs /usr/local/bin
docker run --rm --entrypoint node -v "${PWD}:/repo:ro" -w /repo ss01-bench:dev yard/tests/telemetry.test.mjs
```

| Case | Stimulus | Expected observations | Automated coverage |
| --- | --- | --- | --- |
| Station switching | HMI opens, resets the latch and closes | Plant contacts and current, yard telemetry, protection, breaker, HMI, IEC 104 and DNP3 views agree. Remote position timestamps match BRF01. | `chain-smoke.mjs` |
| Control interlocks | Close without reset; reset under fault or with protection unavailable | Rejection, with breaker remaining open | `station-control-smoke.mjs` |
| Fault pickup and opening | Inject a process fault, then inject a breaker trip at the console | Trip and 1200 A reach HMI and both masters. Open and 0 A follow, with the breaker source timestamp. | `chain-smoke.mjs` |
| Failed opening | Simulate stuck breaker during fault | Closed position, fault current and source-timed operation failure reach HMI and both masters. | `chain-smoke.mjs` |
| Stall and invalid contacts | Stall breaker movement, then simulate conflicting contacts | Intermediate and invalid quality propagate. Yard telemetry reports stalled or invalid contacts. | `chain-smoke.mjs`, `process-smoke.mjs`, `telemetry.test.mjs` |
| Gateway recovery | Restart IEC 104 gateway | IEC 104 master marks data stale and then recovers it. | `chain-smoke.mjs` |
| Process behavior | Exercise trip, fault, travel and contact failure cases | MMS process and breaker behavior match each scenario. | `process-smoke.mjs` |
| Component web endpoints | Start separate component services | Individual origins and component pages respond, with same-origin content policy. | `chain-smoke.mjs` |

The chain test uses a bench protection permissive and manually injects the breaker trip. It does not establish automatic GOOSE delivery. DNP3 is exercised in the isolated test even when its Compose profile is not running. Yard checks cover telemetry conversion and served assets, not visual rendering or navigation in a browser. Kali connectivity and independent protocol conformance are outside these tests.

## SIMF01 overcurrent and experimental SV

The Compose acceptance test uses SIMF01's same-origin overcurrent and clearance endpoints, checks rejection of a foreign origin, and verifies automatic GOOSE delivery, breaker opening, HMI and IEC 104 indications, DNP3 events, and the stuck-breaker failure case. It passed in an isolated stack with both the normal MMS measurement path and the experimental SV path. On the running stack, a separate SIMF01 UI request was followed by HMI trip and OPEN indications, then the instructor reset restored a verified CLOSED baseline across both masters.

Live observations showed small current changes at SIMF01, the station HMI and both masters. Independent polling can make the displayed samples briefly differ. The SV chain remains experimental because captured sample gaps produce intermittent invalid current quality. Its [validation report](../outputs/sv-validation-report.md) records the captures and publisher-loss check.

An additional [GOOSE timing report](../outputs/goose-timing-variation-report.md) records stable retransmissions during live current variation and trip/clear retransmissions in the isolated stack. It also records the observed timing deviations and an instructor-reset race addressed after the capture.

## Additional validation on 21 November 2026

- A separate Docker stack built with `compose.goose.yaml` passed `containers/smoke.mjs --goose`. The test exercised automatic GOOSE trip, confirmed breaker opening and IEC 104 monitoring, then checked a stuck-breaker alarm. BRF01 logged asserted and deasserted GOOSE messages.
- A capture from the isolated breaker's network namespace recorded seven frames using the capture filter `ether proto 0x88b8`, with zero capture drops. The capture was taken after the scenario, while the protection trip remained asserted. It establishes the presence of GOOSE EtherType traffic, but is not a timing, frame-content or conformance analysis.
- At initial startup the HMI showed INVALID breaker MMS points even though a fresh `station-client read` succeeded. Restarting the isolated HMI, gateway and control centre restored the HMI indication. The triggering condition and recovery behavior need investigation.
- The running Kali container had only its isolated `kali-wan` network and no route to the station. Its noVNC service returned HTTP 200 inside the container, while the host request to port 6088 was refused. The WAN attack path and host browser access therefore remain unverified.
- The yard page returned HTTP 200. Browser automation was unavailable and a headless screenshot attempt did not produce an image, so rendering and navigation remain unverified.
- Independent IEC 61850, IEC 104 and DNP3 conformance and interoperability testing remain outstanding. The successful tests use project-supplied peers.
