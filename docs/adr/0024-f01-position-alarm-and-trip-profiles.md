# ADR 0024 — Preserve F01 position and alarm across monitoring protocols

**Status:** Monitoring mappings implemented and bench-tested. Linux GOOSE configuration implemented. Ethernet acceptance pending.

## Decision

BRF01 owns position, position quality, and operation failure. Preserve valid intermediate independently of invalid position in the shared MMS reader and on the supervisory double-point paths. Publish the BRF01 operation-failure single point with its original event time through IEC 104 IOA 103 and DNP3 binary input 1. IEC 104 interrogation and DNP3 static scans may supply state without an event timestamp. A same-state untimed read can retain a previously received source time from the same connection.

SIMF01 remains on the process network. The yard gets its measurements through the simulator container and labels two contacts still clear on a fresh read after the training movement deadline as STALLED. It shows the timestamp of the underlying contact change. BRF01's discrete operation-failure alarm remains authoritative for the IED and supervisory views.

The original injected-trip default is superseded by [ADR 0030](0030-goose-required.md). The current Compose deployment activates the SCL publisher and subscriber on the designated station network and scopes raw socket capability to those two IED services.

## Remaining acceptance

- Run the [Linux wire procedure](../../specs/001-feeder/p1-linux-run.md) and correlate a GOOSE assertion, a single actuator request, contact-confirmed feedback, and the station and supervisory indications. Include negative control, expiry, restart, and timing.
- Establish SV channel mapping, per-channel quality and synchronization in the merging-unit profile before commissioning the relay against sampled CT/VT inputs.
- Engineer station control at BRF01. The control profile must define local/remote authority, selection and expiration, interlocks checked at execution, trip precedence, and termination based on confirmed feedback. A future IEC 104 or DNP3 command adapter must use the same BRF01 authority and map rejection, timeout and operation completion separately.
- Verify host/process source time, clock loss and recovery, and protocol timestamp semantics independently. Record declared device profiles and independent conformance results against the [release criteria](../../specs/001-feeder/protocol-profiles.md).
