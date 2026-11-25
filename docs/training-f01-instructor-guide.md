# SS-01 F01 instructor guide

Use [instructor scenarios](instructor-scenarios.md) for console startup, scenario commands and reset. Confirm reset succeeded before starting each exercise. This guide describes the simulated F01 bay and the supported pilot functions.

The current and fault expectations in this table assume the **plant-MMS**
profile. With direct HTTP input, PRF01 follows the HMI slider rather than
SIMF01's feeder current; opening the breaker does not automatically set the
injected value to zero. See the [as-built measurement profiles](as-built.md#measurement-profiles)
before selecting a scenario.

| Exercise | Setup and stimulus | Expected observations |
| --- | --- | --- |
| Normal bay | Reset baseline. | Plant contacts indicate CLOSED. PRF01 and the HMI show approximately 118–122 A and trip clear. HMI and running remote masters show good-quality CLOSED. |
| Station switching | Reset baseline. Ask trainee to open and close from 52-F01. | HMI reports position-confirmed operations. OPEN corresponds to 0 A and CLOSED to approximately 118–122 A. A latch reset may be required before close. |
| Feeder fault | Reset baseline, then apply `fault`. | PRF01 latches trip. GOOSE reaches BRF01, which opens. Once open, feeder current falls to 0 A. The protection trip remains asserted until the fault is cleared and protection reset. |
| Failed opening | Reset baseline, select `stuck`, then apply `fault`. Wait for movement timeout. | Trip is asserted, position remains CLOSED, current remains 1200 A and operation failure is asserted at BRF01 and the HMI. |
| Lost IEC 104 gateway | Reset baseline, then use `gateway-stop`. | The IEC 104 control centre marks its points stale. Station protection and local indications continue. `reset` starts the gateway and checks recovered remote points. |

For packet analysis, use the [GOOSE trip-cycle capture](../outputs/goose-trip-cycle.pcapng). Frames 10410 and 10417 show an asserted trip and its first retransmission at the subscriber capture point. Frame 10776 is a later deassertion. See the [capture report](../outputs/goose-trip-cycle-report.md) for test context and limitations.

The exercise values are simulation outputs. Formal protocol conformance, synchronized timing and independent interoperability remain separate acceptance items. Record trainee observations and any mismatch before resetting the exercise.
