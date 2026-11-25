# P1 live Linux run sheet

**Objective.** Prove PR-F01 trip delivery and independent BRF01 feedback before using BRF01 as the accepted position source in the station HMI and gateway. This is a functional lab test. Separate device conformance evidence belongs in the [device profiles](protocol-profiles.md).

## Entry checks

1. Use an isolated Linux Ethernet segment and build both programs with native GOOSE enabled. Record the commit/build, interface names, versioned CID files, dataset types and order, APPID, revision and publisher identity. Use the declared development profile and inspect the actual runtime values. Confirm independent native reads of PR-F01 and BRF01 before any trip.
2. Start the distributed configuration with the combined IED position source excluded from both station consumers. Launch the station view with `node src/serve.mjs --native build-native`. Give HMI and gateway independent configured MMS access. Record the source shown in the HMI table and the declared mapping at the gateway.
3. Provide a way to disable only GOOSE delivery while leaving BRF01 and its MMS interface running. Provide distinct actions to clear the simulated fault, reset a latch, and close. Older bench commands are insufficient if they cannot establish these conditions. Record any unmet prerequisite as blocked.
4. Establish a timing budget before collecting pass/fail evidence. Proposed provisional P1 training thresholds are at most **100 ms** from initial valid trip frame at the test capture point to BRF01 receipt on the reference host, and at most **500 ms** from receipt to confirmed breaker feedback in the bench mechanism. These are lab hypotheses, not IEC performance-class claims. Record the measurement points, common clock or correlation method, uncertainty, sample count and load. An acceptance run with unmeasurable timing remains incomplete.

## Execution order

1. **Baseline.** Verify CE-01. Capture the normal publisher and subscriber state, then record position, quality, timestamp and owner at both station consumers.
2. **Negative control.** Disable only GOOSE delivery and apply an instructor trip. Verify CE-02. Explicitly clear the fault and restore the declared CLOSED baseline with a fresh run ID before the next test. Preserve the first capture separately.
3. **Live handoff.** Enable delivery and repeat the same trip. Verify CE-03 from packet, subscriber, actuator and MMS evidence. Allow enough retransmissions to demonstrate that the actuator counter increases only once.
4. **Reset and close.** With the breaker open, leave the fault active and verify CE-04. Clear it explicitly and verify CE-05. A reset and a close must produce distinct trace entries.
5. **Expiry and restart.** Run CE-06 as three separate subcases. Test a fresh trip assertion received on startup, stale clear, and an independent BRF01 restart with the actuator still reporting its pre-restart state. Use the fixture's positive reset procedure between subcases.
6. **Station source verification.** Repeat CE-03 with both station consumers active. A passing result names BRF01 as the position source on both and distinguishes the PR-F01 trip indication.

## Evidence record

For each case capture build and SCL revisions; time basis; preconditions; requested action; expected and observed indications; packet/event references; actuator count; timing measurements; verdict **PASS**, **FAIL**, or **BLOCKED**; and the next corrective task. Keep publisher, subscriber, BRF01 MMS and station logs aligned to the same run ID. Record live Ethernet and bench results separately.

**Bench status.** The [distributed smoke](../../native/distributed-smoke.mjs) passed on Windows with native MMS, IEC 104 and DNP3 and simulated contact and trip input. It checked that a PRF01 trip without delivery leaves BRF01 closed, repeated trip inputs open it once, stale inputs and missing fault clearance block commands, and BRF01 restarts UNKNOWN until fixture reconciliation. The combined native and protection console smoke checks also passed.

**Live status.** P1 still requires an isolated Linux Ethernet run with actual frames, packet timing and independent publisher restart. The read-only operator view is available and its MMS bridge passed the Windows bench scenario. Capture its observed indications again during the Linux run. This host could not start WSL or reach the Docker Linux engine. Use the [native distributed startup procedure](../../native/README.md#distributed-breaker-exercise).
