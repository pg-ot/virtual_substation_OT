# ADR 0027 — GOOSE subscriber sequence validation

## Context

An isolated packet-injection test showed that the subscriber accepted a lower state number while a newer state was still live. The underlying library checks same-state sequence ordering, while the application must also decide how to handle state transitions and publisher restarts.

## Decision

BRF01 tracks the last accepted state and sequence independently. While the accepted message remains live, a same-state sequence or changed state must advance in 32-bit serial arithmetic. Duplicate, backward and ambiguous half-range changes are ignored. Invalid frames do not extend the application's GOOSE lifetime. Once the accepted message expires, the next valid message can establish a new baseline.

## Consequences

A publisher that restarts with a lower state number while its prior message is live may need to wait for the prior time allowed to live to expire before its new stream is accepted. This is a lab policy requiring independent interoperability and performance validation. It is not a conformance claim. Subscriber parse validation, data-set and configuration-revision checks remain in force.
