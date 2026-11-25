# 001 — One feeder bay

## Stories and acceptance

- **P1 / FR-01 — Operate locally.** With a healthy feeder, a station operator in LOCAL can open or close 52-F01. Clear feedback distinguishes command acceptance from actual position. A local command in REMOTE is rejected.
- **P1 / FR-02 — Trip independently.** A simulated fault opens the feeder and latches the trip in either selector mode. Closing is rejected during the fault or latch. Clearing a fault and resetting locally leaves the breaker open until a separate close.
- **P1 / FR-03 — Supervise and recover.** With a closed feeder, disconnect the supervisory link and apply a fault. Station feedback changes to OPEN with zero current. The control centre holds CLOSED with stale quality and its original sample timestamp. Commands are blocked until a fresh snapshot after reconnection. Requests during the outage never replay.
- **P1 / FR-04 — Inspect the yard.** A learner can switch between overview and ground-level views and inspect a bus, breaker 52-F01, outgoing feeder and relay cabinet. Confirmed breaker and latch feedback drives the indicators. Show local and control-centre status alongside the yard.
- **P1 / FR-05 — Run the classroom exercise.** An instructor can apply/clear a fault, toggle the link, select local/remote and reset the exercise. The UI shows accepted and rejected actions chronologically. A reset restores the known initial state.
- **P1 / FR-06 — Operate interoperable devices.** The IED, station client, peer IED, gateway and supervisory clients implement their declared native IEC 61850 MMS/GOOSE, IEC 104 or DNP3 profiles. An independent peer can exercise the declared functions. Learners can correlate equipment state, HMI indications and wire evidence. See [device profiles and release criteria](protocol-profiles.md).

## Scope

One fictional bay with a fixed healthy load and a simplified fault input. Add the visual exercise and event log before distributed protocol integration.
