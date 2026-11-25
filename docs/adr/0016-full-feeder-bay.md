# ADR 0016 — Build a complete one-feeder station and process architecture

**Status:** Accepted target. Implementation is incremental.

**Decision.** Match the three levels in the reference drawing. Model one active 11 kV outgoing feeder in a fictional 33/11 kV station. Engineering is performed using versioned configuration and build tooling. A dedicated engineering workstation is outside the lab scope.

| Level | Target | Acceptance |
|---|---|---|
| Station | Operator HMI, gateway, IEC 104 control centre with DNP3 alternate, and lab time source | Independent native MMS consumers. The control centre retains stale values during WAN loss and resynchronizes on fresh feedback. Events preserve source time and time quality. |
| Bay | Protection IED PR-F01 and breaker control IED BRF01 | A native GOOSE trip reaches BRF01. It reports XCBR position independently. GOOSE expiry is observable and causes no automatic close. |
| Process | Feeder and breaker simulator, CT/VT model, merging unit and breaker process I/O | Stream synthetic three-phase values over native Sampled Values. Confirm breaker position through process I/O. Protection still runs during supervisory WAN loss. |

**First slice.** BRF01 owns its simulated XCBR position and exposes it over native MMS. The GOOSE-enabled build routes validated trip assertions to its open-and-latch behavior. The explicit bench mode exercises breaker behavior and MMS feedback without Ethernet. The breaker console shows its independent MMS feedback alongside the GOOSE trip. [ADR 0017](0017-distributed-breaker-handoff.md) records source routing and interlocks in the distributed development profile.

**Consequences.** Verify the handoff on isolated Ethernet, connect the station HMI and gateway to BRF01 feedback, and then separate physical breaker and CT/VT state into process-level services. The combined IED remains a baseline exercise.
