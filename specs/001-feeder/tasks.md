# Tasks

See the [full architecture plan](full-architecture-plan.md) for the phase sequence and release acceptance. Complete the native Linux process run before Compose packaging.

Use the [low-level design](low-level-design.md) for service and point contracts and acceptance vectors LL-01 through LL-08.

## M1 — Executable model

- [x] T001 Write requirements, plan, constitution and ADR index.
- [x] T002 Implement feeder and local protection behavior (FR-01, FR-02).
- [x] T003 Implement snapshot, outage and resynchronization behavior (FR-03). Depends on T002.
- [x] T004 Assert the classroom outage, trip, reconnect and recovery sequence. Depends on T003.

## M2 — Classroom UI

- [ ] T005 Serve station and supervisory views from the model, with separate command and feedback states (FR-01, FR-03).
- [ ] T006 Build the original 3D yard with live bay and relay indicators (FR-04). Depends on T005 for integration.
- [ ] T007 Add instructor actions, reset and timeline, then verify FR-04 and FR-05 through the browser. Depends on T005 and T006.

## M3 — Transport

- [ ] T014 Port the process model to C++ and run parity checks against the offline baseline.
- [ ] T015 Connect the feeder IED to the process model and verify feedback, interlocks and local trip behavior. Depends on T014.
- [ ] T016 Build the Godot WebGL yard and Nginx/PHP telemetry bridge. Depends on T014.
- [ ] T017 Integrate open-source native MMS/IEC 104 SCADA drivers into the existing HMI and verify both operator workflows. Depends on T015, T016 and the relevant native protocol endpoints.
- [ ] T018 Record licenses and versions for all shipped software, toolchain dependencies and assets. Resolve DNP3 maintenance ownership before release.
- [x] T019a Implement the offline lab portal, IED faceplate and gateway diagnostics. Verify navigation, WAN outage, trip, synchronization and reset with the bundled page script.
- [ ] T019b Serve device APIs and connect station and supervisory pages to their independent native protocol clients per ADR 0011. Repeat the outage exercise through the browser across the deployed services.
- [x] T020 Implement independently launched feeder, protection IED, gateway and supervisory services with asset-specific read-only consoles.
- [ ] T021 Verify the four-process outage scenario over loopback, then integrate the service-backed station HMI before packaging.

- [ ] T008 Validate isolated Compose networking on the teaching host and review ADR 0003.
  - [x] T008a Define the native TCP bench image, Compose networks, role endpoints and acceptance script.
  - [ ] T008b Build and exercise the Compose stack on a Linux Docker Engine. Verify service startup, listener bindings and host HMI access.
- [ ] T009 Pin standards, profile options and test procedures, then evaluate stacks and independent test peers (FR-06).
  - Candidate shortlist and first interoperability exercises recorded in [ADR 0007](../../docs/adr/0007-native-stack-evaluation.md).
- [ ] T010 Engineer the SCL model and validate MMS server/client behavior and native GOOSE publisher/subscriber exchanges (FR-06). Depends on T009 and an isolated native Linux test network.
  - The development CID now generates the live IED model and peer subscription settings. See [ADR 0014](../../docs/adr/0014-engineer-the-feeder-in-scl.md).
- [ ] T011 Build the IEC 104 point map and verify both roles against independent peers (FR-06). Depends on T009 and the station point model from T010.
- [ ] T012 Build the DNP3 point map and XML Device Profile, then verify both roles against independent peers (FR-06). Depends on T009 and the station point model from T010.
- [ ] T013 Run applicable conformance cases and the outage exercise for both supervisory configurations. Archive the evidence and reconcile verdicts with declared profiles (FR-03, FR-06). Depends on T010–T012.
- [x] T022a Build and verify the native MMS, IEC 104 and DNP3 loopback scenario using `native/smoke.mjs`.
- [ ] T022b Build and verify the GOOSE publisher/subscriber on an isolated Linux interface. Independent peers and complete profiles remain T010–T013.
- [x] T023 Integrate the current build into the reference repository, replace its default launchers and exercise the protection console against real MMS.
- [ ] T024 Verify BRF01 trip reception on live GOOSE and route independent breaker feedback to station and supervisory views. Use [CE-01–CE-06](cause-effect.md) and capture the evidence in the [P1 live Linux run sheet](p1-linux-run.md).
  - [x] T024a Implement and bench-test source separation, local reset/close guards, and UNKNOWN/reconciliation on restart through native MMS and both telecontrol adapters.
  - [ ] T024b Capture live Ethernet, timing, and station operator view evidence.
  - [x] T024c Connect the read-only station single-line to the independent MMS client and verify per-point loss and recovery.
- [ ] T025 Separate breaker and CT/VT plant state, implement merging unit and process I/O services, and verify native Sampled Values on the isolated process bus.
  - [x] T025a Run an independent C++ breaker and feeder fixture and connect BRF01 contact confirmation and PRF01 synthetic current over local MMS.
  - [x] T025b Bench-test no travel, mid-travel stall, contradictory contacts, trip priority during closing, and process feedback loss.
  - [ ] T025c Engineer the process I/O and merging unit profiles, use the isolated process bus, and display the operation-failure state on the station single-line.
- [ ] T026 Connect the station time source and test source time, quality and the full WAN-loss exercise.
- [ ] T027 Prove the pinned Linux stack's native SV build and document publisher, subscriber, process-I/O and time roles and tests. Complete the P0 profile and transport decisions before depending on process-bus behavior.
- [ ] T028 Define independent MMS report blocks, source quality/time, and event-gap handling. Test concurrent station and gateway subscriptions, recovery and overflow. Version the distributed separation of trip output and latched close block.
- [ ] T029 Define the native control-result crosswalk and snapshot/event merge rules for IEC 104 and DNP3. Test an event during reconnect interrogation, missing or invalid feedback, pending selection expiry and physical confirmation separately.
