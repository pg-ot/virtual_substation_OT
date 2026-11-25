# Implementation plan

The [full three-level architecture plan](full-architecture-plan.md) is the active roadmap for the integrated build. The milestones below describe the original feeder baseline and protocol work.

Use the [project principles](../../constitution.md) and [ADR index](../../docs/adr/README.md) to check changes. The workflow uses feature requirements, a technical plan and traceable tasks from [GitHub Spec Kit](https://github.github.com/spec-kit/quickstart).

[ADR 0008](../../docs/adr/0008-grficsv3-runtime.md) defines the target runtime. M1 and M2 below describe the offline baseline. Use the [GRFICSv3 migration plan](grfics-migration.md) to carry its acceptance scenarios into the containerized simulator.

## M1 — Executable model

Implement process, IED and gateway as separate ESM modules connected by a classroom coordinator. The coordinator advances a deterministic clock, forwards commands once and samples state at explicit steps. Start closed, energized, healthy and in LOCAL, with a live supervisory sample. Recreating the coordinator resets the exercise.

| Boundary | Data and ownership |
|---|---|
| Feeder → IED | Confirmed OPEN/CLOSED, bus kV, feeder amperes, physical fault flag |
| IED → feeder | Simulated breaker operation, mediated by the IED |
| IED → station / gateway | Feeder feedback, latch and mode |
| Gateway → control centre | Snapshot, source timestamp and quality UNKNOWN/LIVE/STALE |
| Control centre → gateway | Open/close request evaluated against freshness and local/remote selection |

A link-down transition retains the previous sample. Link-up alone cannot grant supervisory authority. A new sample transitions the gateway to LIVE. The IED evaluates fault and latch before a close. A reset clears a latch only through local operation after the physical fault clears.

## M2 — Visual classroom experience

Serve a local browser build with a 3D yard and side-by-side station and supervisory views. Create original low-poly buswork, breaker and relay cabinet geometry. Bind the 3D indicator to confirmed state and keep instructor actions on a separate panel. Record action origin, result, time and resulting state. Rehearse the outage exercise and a full reset through the actual UI.

## M3 — Distributed transport

Start protocol research in parallel with M2. Pin standards and compare maintained stack candidates for each role. Establish the SCL model and station MMS/GOOSE exchanges, then implement IEC 104 and DNP3 supervisory configurations using a reviewed point map. Validate the isolated layout, including Layer 2 GOOSE traffic. Record each stack selection in an ADR. Apply the [device profile release criteria](protocol-profiles.md) and rerun the outage, trip and reconnect scenario over both supervisory configurations.
