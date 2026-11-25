# ADR 0017 — Separate protection trips from breaker feedback

**Status:** Accepted for development. Live P1 acceptance is open.

## Context

The original native feeder bench combined PRF01 protection and simulated XCBR position. A station client could show OPEN after a feeder fault without evidence that BRF01 received or carried out the trip.

## Decision

- Select the distributed development profile with `LAB_DISTRIBUTED=1`. PRF01 publishes `PTRC1.Tr.general` and its quality in the GOOSE dataset at configuration revision 3, as updated by [ADR 0030](0030-goose-required.md). Its legacy position is invalid and its MMS breaker controls reject commands in this profile.
- BRF01 serves read-only `BRF01LD0/XCBR1.Pos` over MMS. The station client and both telecontrol adapters acquire position from this point and acquire trip and synthetic current from PRF01. Distributed station monitoring uses polling until separate report blocks are engineered.
- BRF01 consumes asserted and deasserted GOOSE with a monotonic freshness deadline. Trip latches closing and issues one simulated open operation for confirmed CLOSED. Local reset and close need fresh deasserted protection, confirmed OPEN and explicit fixture fault clearance. Close additionally needs an already cleared latch.
- At startup BRF01 exposes UNKNOWN contacts and applies a conservative close inhibit. The local fixture reconciles the independent feedback. A pending trip takes effect if reconciliation confirms CLOSED.

## Alternatives and consequences

The combined device remains available for its existing regression exercise. Deriving distributed position from PRF01 trip would make a GOOSE delivery failure indistinguishable from a successful operation.

The fixture supplies contact reconciliation and fault clearance until the process-level service is available. Injected input and native TCP results are recorded separately from isolated Ethernet delivery, timeout, timing and conformance evidence. See the [P1 run sheet](../../specs/001-feeder/p1-linux-run.md).
