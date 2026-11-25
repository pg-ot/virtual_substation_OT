# ADR 0025 — Control the simulated F01 breaker from the station HMI

**Status:** Implemented for the distributed process bench.

The station HMI serves monitoring and operator controls on one origin. Open and Close use the native station client to issue direct control with normal security to BRF01 `XCBR1.Pos`. BRF01 queues the request and rechecks process feedback and close permissives before it dispatches the existing SIMF01 actuator. A protection trip has priority over station control. Reset latch is a separate MMS command at `BRF01LD0/GGIO1.SPCSO1` and requires confirmed OPEN, clear plant fault, and fresh clear protection input. Its feedback is `BRF01LD0/GGIO1.Ind2`.

The earlier bench used a polled MMS permissive. [ADR 0030](0030-goose-required.md) supersedes that default. The Compose deployment uses the GOOSE input and expiry for the protection permissive. Missing, invalid or asserted inputs prevent station release.

The HMI reports MMS acceptance separately from newer, good-quality contact feedback. It serializes browser requests, validates loopback origin on the POST, and never retries a control request on a timeout. The gateway and historical non-process HMI profiles retain their existing behavior.

The direct-normal control acknowledgement is used for request acceptance. Confirmed breaker motion comes from the independent monitoring stream. Enhanced control, named operator authorization, and independent conformance checks belong to the engineered station profile.
