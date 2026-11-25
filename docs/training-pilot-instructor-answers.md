# SS-01 F01 pilot instructor answers

Use with the [trainee worksheet](training-pilot-worksheet.md) and [instructor scenarios](instructor-scenarios.md). These expectations apply to the running MMS process-measurement profile with Layer 2 GOOSE enabled. An independently verified standards-conformance result is outside the scope of this exercise.
For the direct-HTTP profile use the separate
[direct-HTTP pilot guide](training-direct-http-pilot.md); the fault and
current expectations below do not apply unchanged.

Before each exercise run `node containers/instructor.mjs reset` and wait for `Baseline verified`. The expected baseline is CLOSED, approximately 118–122 A, clear trip, clear latch and no operation failure. Verify that the station and selected remote views have good-quality points. If baseline verification fails, investigate before proceeding.

## Exercise 1 — Station switching

The faceplate open command should produce confirmed OPEN position and approximately 0 A. After latch reset, close should produce confirmed CLOSED position and approximately 118–122 A. SIMF01 contacts and BRF01 position provide process and device feedback. The HMI and remote views should eventually agree. A command acknowledgement and confirmed position are distinct observations.

## Exercise 2 — Feeder overcurrent

Apply `node containers/instructor.mjs fault` from the closed baseline. SIMF01 raises the fault current and PRF01 asserts its trip. PRF01 publishes the trip over Layer 2 GOOSE. BRF01 processes the trip and reports contact-confirmed OPEN after the simulated breaker moves. Current subsequently falls to 0 A. The HMI and remote position and current views should converge. Transient observations can differ because the devices and views update at different times.

## Exercise 3 — Breaker fails to open

From the baseline apply `node containers/instructor.mjs stuck`, followed by `node containers/instructor.mjs fault`. PRF01 asserts trip, but BRF01 eventually reports operation failure while position remains CLOSED. The simulated feeder continues to carry fault current, approximately 1200 A. Operation failure is available at the HMI and both remote views when their gateways and masters are running. Contrast trip assertion with the absence of a successful open indication.

## Exercise 4 — IEC 104 communication loss

From the baseline apply `node containers/instructor.mjs gateway-stop`. The IEC 104 master eventually marks position STALE. Its last value is historical once communication has been lost. The station path remains available. Apply `node containers/instructor.mjs reset` to restart the gateway and verify baseline recovery. Confirm the remote indication returns with usable quality.

## Debrief and reset

The expected sequence is simulated process current, PRF01 pickup and trip, GOOSE publication, BRF01 trip processing, simulated breaker movement and contact feedback, then station and supervisory indication. PRF01 trip is evidence of the protection decision. BRF01 position is the feedback used to identify the simulated breaker's settled state. The station HMI and gateway obtain their device data over the configured station path, and IEC 104 or DNP3 conveys supervisory points to the corresponding master.

Run the instructor reset after each exercise and at the end of the session. Record the actual observations and any discrepancies. The automated instructor acceptance covers baseline, automatic fault trip, reset and IEC 104 loss and recovery. The stuck-breaker case has separate automated component acceptance. A complete human-led rehearsal and browser walkthrough remain outstanding.
