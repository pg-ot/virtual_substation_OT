# Architecture decision records

Use increasing IDs. Include status, context, decision, alternatives and consequences. Mark an accepted ADR as superseded only after its successor is accepted, and link both records.

- [0001 — Separate process state, protection and supervision](0001-state-ownership.md) — Accepted
- [0002 — Start with deterministic JavaScript modules](0002-first-slice.md) — Prototype decision, superseded for target runtime by ADR 0008
- [0003 — Isolate lab networks and adapt protocols at the gateway](0003-deployment.md) — Proposed topology, protocol scope superseded by ADR 0004
- [0004 — Require native protocol behavior for declared device profiles](0004-protocol-fidelity.md) — Accepted
- [0005 — Use industrial operator display conventions](0005-operator-interface.md) — Accepted
- [0006 — Render the yard with fixed inspection viewpoints](0006-yard-view.md) — Prototype decision, superseded for target runtime by ADR 0008
- [0007 — Evaluate native stacks before pinning dependencies](0007-native-stack-evaluation.md) — Proposed, DNP3 candidate superseded by ADR 0010
- [0008 — Use the Fortiphyd GRFICSv3 runtime stack](0008-grficsv3-runtime.md) — Partially superseded by ADR 0009
- [0009 — Use native SCADA drivers and an independent feeder IED](0009-native-scada-and-ied.md) — Accepted device roles, SCADA candidate superseded by ADR 0010
- [0010 — Require an all-open-source runtime and build toolchain](0010-open-source-stack.md) — Accepted architecture
- [0011 — Serve device interfaces from a shared lab portal](0011-web-device-interfaces.md) — Proposed
- [0012 — Run virtual assets as independent processes before packaging](0012-standalone-device-processes.md) — Accepted for first service integration
- [0013 — Build native protocol device programs before migrating the consoles](0013-native-protocol-first-slice.md) — Accepted for development
- [0014 — Generate the feeder IED model from SCL](0014-engineer-the-feeder-in-scl.md) — Accepted for development
- [0015 — Use virtual_substation_OT as the project repository](0015-reference-repository-foundation.md) — Accepted for the integration branch
- [0016 — Build a complete one-feeder station and process architecture](0016-full-feeder-bay.md) — Accepted target
- [0017 — Separate protection trips from breaker feedback](0017-distributed-breaker-handoff.md) — Accepted for development
- [0018 — Connect the read-only station single-line to native MMS](0018-read-only-station-mms.md) — Accepted for development
- [0019 — Separate breaker mechanism and feeder state from the bay IEDs](0019-independent-process-simulator.md) — Accepted for development
- [0020 — Package the native TCP bench in Docker Compose](0020-compose-bench.md) — GOOSE configuration superseded by ADR 0030
- [0021 — Serve component views from one browser origin](0021-component-web-views.md) — Superseded by ADR 0022
- [0022 — Serve each component from its own web port](0022-dedicated-component-web-ports.md) — Accepted for the container bench
- [0023 — Render the F01 process yard from live SIMF01 feedback](0023-live-simf01-yard.md) — Accepted for the container bench
- [0024 — Preserve F01 position and alarm across monitoring protocols](0024-f01-position-alarm-and-trip-profiles.md) — Monitoring and isolated Linux wire exercises performed; full acceptance remains open
- [0025 — Control the simulated F01 breaker from the station HMI](0025-station-hmi-breaker-control.md) — Implemented for the distributed process bench
- [0026 — Instructor workflow](0026-instructor-workflow.md)
- [0027 — GOOSE sequence validation](0027-goose-sequence-validation.md)
- [0028 — Sampled Values training profile](0028-sampled-values-training-profile.md)
- [0029 — Remote switching boundary](0029-remote-switching-boundary.md)
- [0030 — Layer 2 GOOSE is required](0030-goose-required.md) — Accepted for the Compose deployment
