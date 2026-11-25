# IEC 61850 implementation checklist

Use this checklist for the SS-01 lab and its declared GOOSE, Sampled Values
(SV), and MMS roles. An unchecked item means **not yet accepted with the
required evidence**, not necessarily absent from the implementation. Mark an
item N/A only with a documented reason. This is an engineering checklist, not
a substitute for the applicable normative text or a conformance certificate.

For each applicable item, record the requirement or profile reference,
device/build, configuration, test procedure, result, evidence, and reviewer.
Do not treat a successful packet decode or an in-house smoke test alone as
proof of conformance.

The overview in sections 1–4 and the detailed checks in sections 5–9 are
complementary. Item IDs are **checklist IDs**, not IEC clause or official test
case numbers. Apply each item to each relevant device role and supported
configuration. Some items are implementation checks, some are engineering or
system acceptance checks, and some apply only when the corresponding feature
is selected; they are not all unconditional IEC requirements.

### Requirement and test record

Before using this as an acceptance matrix, create a record for each applicable
check and split it into separate requirements or test cases where needed:

| Field | Record |
|---|---|
| Checklist ID / device role | Item ID, publisher/subscriber or client/server, and device/build |
| Source | Selected standard edition, amendment and **verified** clause; or project/vendor requirement |
| Applicability | Mandatory, conditional or optional for the selected role; justification for N/A |
| Configuration | SCL revision, datasets, network, timing, security and feature settings |
| Test | Procedure ID/version, preconditions, input, expected result and acceptance threshold |
| Result | PASS, FAIL, BLOCKED or N/A; observed values, evidence location, date and reviewer |

Select the standard editions and application profile first; obtain and review
the applicable normative publications and test procedures before assigning
clause numbers or declaring coverage complete. No clause-level traceability
or formal conformance has been established by this document.

## 1. Common engineering and acceptance

- [ ] Identify publisher/subscriber and server/client roles, intended use,
  interfaces, device versions and the applicable IEC editions and amendments.
- [ ] Declare mandatory services and selected options for each role; maintain
  applicable PICS, MICS, PIXIT and other profile information.
- [ ] Version and validate the SCL and check that deployed models, datasets,
  addresses and control-block settings match the engineered configuration.
- [ ] Define the required performance, network load, loss assumptions and
  fail-safe behavior before testing. Distinguish application requirements from
  vendor defaults and optional features.
- [ ] Declare the clock source, accuracy and synchronization requirements.
  Test loss and recovery of synchronization where required. PTP and a specific
  PTP profile are not assumed unless selected.
- [ ] Engineer multicast forwarding, bandwidth, VLAN/priority where used, and
  isolation from unrelated traffic. Test the actual network under expected
  load and failure conditions.
- [ ] Define the security profile, access controls and key management where
  required; measure its impact on timing and verify interoperability.
- [ ] Test with independent peers or test equipment. Record exact builds,
  settings, observation points, time basis, measurement uncertainty and
  results. Keep certification separate from laboratory testing.

## 2. GOOSE — publisher and subscriber

### Configuration and wire format

- [ ] Engineer the GOOSE control block, dataset references, ordered members,
  types, quality, configuration revision, APPID and destination MAC.
- [ ] Configure the Ethernet interface and VLAN ID/priority when required by
  the network profile; confirm the transmitted frames match the configuration.
- [ ] Verify GOOSE encoding and required fields with an independent decoder and
  peer, including control-block reference, dataset reference, identifiers,
  state/sequence numbers, time allowed to live (TAL), test/simulation and
  commissioning indications as applicable.
- [ ] Confirm publisher and subscriber agree on configuration, dataset
  layout, identity and permitted operating modes; reject or alarm on mismatches
  according to the declared profile.

### State changes, retransmission and loss

- [ ] Verify a dataset state change produces a new state number and initial
  transmission, followed by correctly sequenced retransmissions. Verify
  steady-state retransmission and counter rollover/restart behavior.
- [ ] Engineer and record MinTime, MaxTime, the actual retransmission pattern
  and TAL against the application's loss and timing requirements. Do not treat
  any one vendor interval as universally required by IEC 61850.
- [ ] Confirm the subscriber handles duplicates, missing, delayed, out-of-order
  and invalid messages correctly, without repeating a one-shot trip action.
- [ ] Test TAL expiry, publisher and subscriber restart, restoration, and the
  first valid state after restart. Verify the commissioned stale-data and
  protection behavior.
- [ ] Test good/invalid quality and test, simulation, and commissioning
  indications against the selected operating mode.
- [ ] Measure event-to-first-frame and event-to-subscriber/application response
  under representative load and failures, including loss of the first frame.
  Measure steady retransmission separately; it is not trip-transfer latency.
- [ ] Exercise the complete protection action, independent breaker feedback,
  trip latching, fault clearance and permitted reset/close sequence in an
  isolated test environment.

## 3. Sampled Values — publisher and subscriber

### Profile and data

- [ ] Select the applicable IEC 61850-9-2 edition and any additional profile,
  such as 9-2LE or IEC 61869-9, when required. Do not assume they are
  interchangeable or that a training profile meets either.
- [ ] Engineer the stream identifier, APPID, destination MAC, optional VLAN
  and priority, control block, configuration revision and dataset.
- [ ] Specify sampling frequency, nominal system frequency, sample-counter
  wrap, ASDUs per frame and any optional fields required by the chosen profile.
- [ ] Define channel order, data types, units, scaling, phase relationship,
  quality and any residual/neutral channels. Verify against an independent
  decoder and known input waveforms.
- [ ] Validate frame and ASDU encoding, stream identification, revision,
  channel order and quality against the configured subscriber.

### Timing, synchronization and failure

- [ ] Verify sample-counter progression and wrap, frame/sample rate, packet
  loss, duplicates, reordering and behavior on publisher/subscriber restart.
- [ ] Measure sample and frame timing, jitter, gaps and sustained throughput
  under representative load, using suitable timestamping and uncertainty.
- [ ] Verify synchronization indication and, where required, accuracy,
  loss-of-sync, holdover and recovery using the selected time profile.
- [ ] Define and test how missing, invalid, stale or unsynchronized samples
  affect measurement validity and the protection function.
- [ ] Verify actual SV-driven pickup through GOOSE delivery and independent
  breaker feedback, including loss, quality and recovery scenarios.

## 4. MMS — server and client

### Model and association

- [ ] Verify TCP connectivity, association establishment, negotiated limits,
  release, timeout and reconnect using an independent client/server.
- [ ] Compare the live logical devices, logical nodes, data objects, attributes,
  functional constraints, types, units, quality and timestamps with the SCL.
- [ ] Verify required discovery, read and permitted write services, access
  errors and handling of invalid or unavailable data.
- [ ] Test the declared client and connection limits, simultaneous clients,
  resource exhaustion and recovery without disrupting protection traffic.

### Reports, controls and operation

- [ ] For selected reporting services, verify datasets, triggers, enable and
  disable, integrity/GI, sequence information, buffering and overflow where
  applicable, and reconnect behavior.
- [ ] For each supported control model, test select/operate/cancel where
  applicable, positive and negative responses, interlocks, timeouts, command
  termination where applicable, and independent physical/simulated feedback.
- [ ] Verify access restrictions for control and configuration; test
  authorization, TLS and certificate handling when part of the security
  profile.
- [ ] Test source and communication failure, quality and timestamp handling,
  recovery, event ordering and protection against replaying stale commands.
- [ ] Test optional services such as setting groups, logs and files only when
  declared, including their unsupported/error behavior.

## 5. Detailed shared implementation and engineering checks

### SCL, models and configuration

- [ ] **C-01** Identify IED name, access point, logical devices and nodes,
  roles, supported services and the network endpoints for every device.
- [ ] **C-02** Validate the selected SCL schema/version and resolve every
  referenced logical node, data object, attribute, dataset and control block.
- [ ] **C-03** Check each dataset member's functional constraint, type,
  structure, order, inclusion and reference against its live model and peer.
- [ ] **C-04** Check publisher/subscriber and client/server bindings against
  the deployed SCL, including interface selection and multicast destinations.
- [ ] **C-05** Define configuration-change rules, `confRev` ownership,
  regeneration, controlled deployment, rollback and compatibility checks.
- [ ] **C-06** Verify model naming, common data class attributes, enumerations,
  quality, time quality, timestamps, units and scale match the chosen model.
- [ ] **C-07** Declare maximum datasets, members, controls, subscriptions,
  streams, connections, rates and message sizes. Test limits and explicit errors.
- [ ] **C-08** Validate startup, shutdown, partial configuration, missing
  interfaces and configuration errors; expose failures rather than silently
  presenting an operational service.

### Time, networking and security

- [ ] **C-09** Specify clock domain, epoch, timestamp source, accuracy,
  synchronization status, time quality and holdover where applicable.
- [ ] **C-10** Use and test a monotonic time basis for local deadlines, expiry
  and duration measurements independently of wall-clock adjustments.
- [ ] **C-11** If synchronized operation is required, validate the selected
  synchronization method, expected accuracy and recovery from clock loss,
  offset, step, holdover and restart.
- [ ] **C-12** Document Ethernet MTU, multicast filters, switches, ports,
  VLAN tagging/priority where selected, capacity and traffic isolation.
- [ ] **C-13** Calculate and test bandwidth and burst capacity for all active
  GOOSE, SV, MMS and other traffic; include ASDU packing and network overhead.
- [ ] **C-14** Where redundancy is selected, verify the specific redundancy
  profile, duplicate handling, failover, recovery and timing during failure.
- [ ] **C-15** Define trust boundaries, authorized peers, management access,
  security logging and the selected IEC 62351 mechanisms where required.
- [ ] **C-16** Where TLS, message authentication or key management is
  selected, test peer compatibility, invalid credentials, expiry, rotation,
  revocation and loss of the supporting service without exposing secrets.
- [ ] **C-17** Define overload behavior, CPU and memory budgets, queue
  limits, diagnostics and resource isolation; test that loss is visible.
- [ ] **C-18** Record applicable PICS, MICS, PIXIT and TICS declarations and
  reconcile declared capabilities, restrictions and test parameters with the
  actual build and configuration.
- [ ] **C-19** Trace the engineering workflow from capability and system SCL
  files to deployed configuration; verify exported files describe the running
  device and that incompatible changes are detected by the affected peers.

## 6. Detailed GOOSE publisher/subscriber checks

### Publisher configuration and transmission

- [ ] **G-01** Verify control-block identity, `gocbRef`, `goID` where used,
  `datSet`, `confRev`, destination MAC and APPID against the SCL and receiver.
- [ ] **G-02** Verify the encoded Ethernet/EtherType, optional VLAN tag,
  priority, header length, BER field types, field lengths and dataset values.
- [ ] **G-03** Verify `goEna` behavior and any supported MMS control-block
  access, configuration restrictions and invalid configuration responses.
- [ ] **G-04** Verify the initial state, timestamp, quality and dataset values
  at enable, after restart and after each relevant data or quality change.
- [ ] **G-05** Check `stNum` progression and `sqNum` reset on a new state;
  check sequence progression on retransmission and profile-specific rollover.
- [ ] **G-06** Verify a new state supersedes the old retransmission sequence
  even when changes occur rapidly or during a burst.
- [ ] **G-07** Record the configured and observed first-send timing, each
  retransmission interval, steady interval and TAL evolution. Verify them
  against the declared profile, including scheduler tolerance.
- [ ] **G-08** Verify `test`, commissioning and simulation indications as
  applicable to the selected edition and operating mode; test normal mode too.
- [ ] **G-09** Verify oversized datasets, missing fields, send failures,
  interface loss and unavailable resources produce diagnosable failures.

### Subscriber validation and state machine

- [ ] **G-10** Check destination, APPID, control-block reference, dataset
  reference, expected revision and dataset layout before delivering an input.
- [ ] **G-11** Verify behavior for mismatched identity, revision, types,
  element count, lengths, malformed encoding and unexpected optional fields.
- [ ] **G-12** Verify startup without a frame, fresh valid state, duplicate,
  newer sequence, missing sequence, older sequence and out-of-order state.
- [ ] **G-13** Exercise counter wrap and publisher restart according to the
  selected profile, both before and after the previous association expires.
- [ ] **G-14** Verify the TAL timer uses the received valid frame and that
  invalid or unrelated traffic does not falsely keep the subscription live.
- [ ] **G-15** Test expiry at burst and steady-state TAL values, recovery
  with clear and asserted states, and stale-data quality/alarm behavior.
- [ ] **G-16** Verify loss of one or more burst frames, including the first
  frame, and confirm the first subsequently accepted current state is applied.
- [ ] **G-17** Test invalid/questionable quality, test/simulation and
  commissioning cases against the application's declared handling policy.
- [ ] **G-18** Confirm repeated accepted retransmissions do not repeatedly
  execute a one-shot action; verify an actual subsequent state change does.
- [ ] **G-19** Measure publisher-event to frame, frame to subscriber
  acceptance, and application-to-application transfer separately; record
  sampling method, clock alignment, uncertainty, load and sample count.
- [ ] **G-20** Verify declared performance and failure criteria with
  independent equipment and the selected test procedure; include network
  congestion, loss, reordering, restart and security overhead when applicable.

## 7. Detailed Sampled Values publisher/subscriber checks

### Profile, source and publisher

- [ ] **S-01** Declare whether the stream is a training profile, 9-2LE,
  IEC 61869-9 or another specified profile; record all applicable editions.
- [ ] **S-02** Define the source and measurement chain, nominal frequency,
  sample rate/mode, counter range/wrap, ASDU count and transmission frame rate.
- [ ] **S-03** Specify `svID`, APPID, destination, interface, revision,
  control-block/dataset references and VLAN/priority if selected.
- [ ] **S-04** Define exact channel order and representation: phases,
  residuals, signedness, bit widths, byte order, scale, units and quality.
- [ ] **S-05** Verify optional fields and their encoding against the selected
  edition/profile, including `smpRate`, `smpMod`, `refrTm`, dataset reference
  and synchronization indication where applicable.
- [ ] **S-06** Verify frame header, encoded lengths, ASDU count/order and
  complete payload using an independent implementation or test set.
- [ ] **S-07** Test value scaling, polarity, phase rotation, frequency,
  amplitude, zero, sign changes and boundary/overflow handling using known
  waveforms and the declared measurement tolerances.
- [ ] **S-08** Verify quality accompanies the correct channels, changes when
  the source becomes invalid and recovers according to the selected profile.
- [ ] **S-09** Verify the sample clock, counter progression, defined wrap,
  synchronization status and any timestamp/reference time semantics.
- [ ] **S-10** Verify missed deadlines, skipped samples and publisher errors
  are reported; do not disguise missed samples as a continuous valid stream.

### Receiver, performance and failure

- [ ] **S-11** Validate stream identity, revision, ASDU count, layout and
  fields before using samples; reject or alarm on incompatible configuration.
- [ ] **S-12** Test individual and burst sample loss, repeated samples,
  reordering, counter wrap, counter reset, publisher restart and timeout.
- [ ] **S-13** Verify multi-ASDU unpacking, ordering and per-sample timing,
  including partial, malformed and unexpectedly sized frames.
- [ ] **S-14** Verify per-channel quality handling, measurement-window
  invalidation and recovery after a sufficiently valid continuous input.
- [ ] **S-15** Test different stream IDs, revisions, APPIDs, destinations and
  invalid synchronization status; unrelated frames must not mask source loss.
- [ ] **S-16** Measure sample spacing and sample/frame loss at publisher and
  receiver separately; account for publisher skips and capture drops.
- [ ] **S-17** Measure sustained throughput, jitter and queue loss at the
  intended rate and number of streams under representative network/CPU load.
- [ ] **S-18** Where required, measure timing alignment across streams,
  clock accuracy, sync loss, holdover and return to synchronization.
- [ ] **S-19** Verify the protection algorithm's declared response to sample
  loss, bad quality, unsynchronized input and restoration without silent
  substitution of a different measurement source.
- [ ] **S-20** Run known-input, threshold and end-to-end SV-to-GOOSE-to-breaker
  tests with independent feedback and traceable timing, including adverse cases.

## 8. Detailed MMS client/server checks

### Association, model and data services

- [ ] **M-01** Declare supported ACSI services, role, transport, MMS mapping,
  addresses, maximum clients, association and negotiated PDU limits.
- [ ] **M-02** Verify connection, association negotiation, normal release,
  abort, lost peer, timeouts, reconnect and resource cleanup.
- [ ] **M-03** Verify namespace browsing and reference resolution for
  logical devices, logical nodes, data objects and supported datasets.
- [ ] **M-04** Validate types, attributes, functional constraints, quality,
  timestamps, units, scaling and enumerations against the SCL and data model.
- [ ] **M-05** Test single/multiple reads, supported writes, access controls,
  malformed requests, invalid references, type mismatch and service errors.
- [ ] **M-06** Where dynamic datasets are supported, test creation, discovery,
  access, size limits, deletion and behavior across association/restart.
- [ ] **M-07** Exercise multiple simultaneous clients, connection limits and
  load, including failure and recovery while GOOSE and/or SV are active.

### Reporting

- [ ] **M-08** Declare supported buffered/unbuffered report control blocks,
  dataset bindings, client ownership/reservation and configuration rights.
- [ ] **M-09** Test enable/disable, reservation and conflicts, read/write
  access and configuration changes in each permitted control-block state.
- [ ] **M-10** Exercise selected data-change, quality-change, data-update,
  integrity and general-interrogation triggers and their reason indications.
- [ ] **M-11** Verify dataset member inclusion/order, optional fields,
  sequence numbers, `confRev`, source timestamps and quality where selected.
- [ ] **M-12** Verify `BufTm`, integrity period, coalescing and event ordering
  against configured values; measure latency rather than assuming it.
- [ ] **M-13** Where buffered reporting is supported, test disconnect,
  buffer capacity/overflow indication, entry IDs, recovery, purge and restart
  according to the declared persistence and recovery behavior.
- [ ] **M-14** Where report segmentation is supported, test segment
  reassembly, missing segments, limits and recovery.
- [ ] **M-15** Where unbuffered reporting is supported, test client loss and
  confirm the declared treatment of events during disconnection.

### Controls and optional services

- [ ] **M-16** Identify the supported control model per object: direct or
  select-before-operate, normal or enhanced security, or no control.
- [ ] **M-17** Test supported select, operate and cancel flows, ownership,
  contention, selection expiry, invalid values and unavailable objects.
- [ ] **M-18** Test supported check/interlock conditions, test mode,
  success/failure responses, additional causes and command termination where
  applicable; verify command response is not mistaken for physical feedback.
- [ ] **M-19** Test duplicate, late and interrupted operations, disconnect
  during control, restart and prevention of unsafe stale-command replay.
- [ ] **M-20** Verify independently sourced operation feedback, timeout,
  intermediate/invalid states, failed operation and recovery.
- [ ] **M-21** If time-activated controls are declared, verify their time
  source, scheduling, invalid time and clock-loss behavior.
- [ ] **M-22** Where supported, test setting groups and edit/confirm/cancel,
  reservation, invalid settings and persistent active-group behavior.
- [ ] **M-23** Where supported, test logs, journals and file services,
  boundaries, permissions, errors, capacity and reconnect behavior.
- [ ] **M-24** Test selected MMS security and authorization profiles,
  certificate lifecycle and denied access; verify diagnostics and recovery.

## 9. System tests and release evidence

- [ ] **T-01** Build a role/service matrix and trace each applicable check to
  verified normative clauses, implementation locations and official test cases.
- [ ] **T-02** Version all SCL, device configurations, source/build hashes,
  dependency versions, network topology and test-procedure revisions.
- [ ] **T-03** Record test topology, measurement points, clock relationship,
  accuracy/uncertainty, duration, repetitions and normal/stress traffic.
- [ ] **T-04** Run nominal, boundary, malformed, loss, restart, recovery and
  overload tests against independent implementations or test equipment.
- [ ] **T-05** Establish criteria for event latency, loss, expiry and
  availability from the selected application/profile; report all observed
  failures and distributions, not just averages or a best-case capture.
- [ ] **T-06** Verify the whole application chain with and without faults:
  measurements, protection, GOOSE, actuator, feedback, MMS and operator view.
- [ ] **T-07** Test invalid inputs and communication, power and clock losses
  independently and in relevant combinations; verify defined safe behavior.
- [ ] **T-08** Review unresolved failures, exclusions and interoperability
  limits; record approvals and re-test triggers for configuration/build changes.
- [ ] **T-09** Complete the applicable IEC 61850-10 and selected external
  test procedures; record certification and its exact scope separately.
- [ ] **T-10** Do not use the training bench as a protection device or claim
  real-time performance, interoperability or conformance without the
  corresponding independently reviewed acceptance evidence.

## 10. SS-01 evidence and open points

These are observations, not checklist acceptance or certification:

- **GOOSE:** the configured MinTime is 20 ms and MaxTime is 1,000 ms.
  An isolated multi-threaded trial passed trip, quality-loss, expiry and
  restart smoke tests. In a simultaneous 120-frame comparison, the largest
  steady interval was 1,038.446 ms on the unchanged live bench and
  1,001.007 ms on the trial. These samples do not establish worst-case
  behavior or event-to-subscriber timing. The candidate was later deployed
  to the then-current bench on 22 November; that historical deployment does
  not establish the identity or state of any currently running project.
  See the [as-built deployment snapshot](as-built.md#deployment-snapshot-23-november-2026).
- **SV:** the experimental profile defaults to 400 samples/s and sets
  `smpSynch` to 0; this is not evidence of synchronized or IEC 61869-9
  operation. Sample gaps and input-quality behavior remain acceptance
  concerns. An optional direct HTTP slider/sequencer input is a separate
  simulation mode, not SV or IEC 61850 process-bus evidence.
- **MMS:** native association, read, and selected control and recovery
  scenarios have been exercised in the lab. Full declared-service coverage,
  independent interoperability and formal conformance remain open.

An [item-by-item implementation assessment](../outputs/iec61850-implementation-validation.md)
records current evidence, gaps and the live preflight result.

Existing lab evidence: [training readiness](training-readiness.md),
[GOOSE timing report](../outputs/goose-timing-variation-report.md),
[SV validation report](../outputs/sv-validation-report.md), and
[device profiles](../specs/001-feeder/protocol-profiles.md).

## References

- [IEC 61850-5: application communication requirements](https://webstore.iec.ch/en/publication/64584)
- [IEC 61850-6: System Configuration description Language](https://webstore.iec.ch/en/publication/84761)
- [IEC 61850-7-2: abstract communication services](https://webstore.iec.ch/en/publication/33197)
- [IEC 61850-7-3: common data classes](https://webstore.iec.ch/en/publication/26687)
- [IEC 61850-7-4: logical node and data object classes](https://webstore.iec.ch/en/publication/27066)
- [IEC 61850-8-1: MMS and Ethernet mapping](https://webstore.iec.ch/en/publication/59775)
- [IEC 61850-9-2: Sampled Values mapping](https://webstore.iec.ch/en/publication/66549)
- [IEC 61869-9: digital instrument-transformer interface](https://webstore.iec.ch/en/publication/24663)
- [IEC/IEEE 61850-9-3: power-utility PTP profile](https://webstore.iec.ch/en/publication/24998)
- [IEC 61850-10: conformance and performance testing](https://webstore.iec.ch/en/publication/108858)
- [IEC 62351-3: security for TCP/IP profiles](https://webstore.iec.ch/en/publication/68410)
- [IEC 62351-4: security for profiles including MMS](https://webstore.iec.ch/en/publication/65438)
- [IEC 62351-6: IEC 61850 communication security](https://webstore.iec.ch/en/publication/63742)
