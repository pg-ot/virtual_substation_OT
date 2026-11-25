# ADR 0004 — Require native protocol behavior for declared device profiles

**Status:** Accepted

**Context.** Synthetic electrical readings are acceptable. Learners must be able to use independent tools and peers to observe standards-accurate device behavior.

**Decision.** Make IEC 61850 MMS and GOOSE, IEC 104, and DNP3 native protocol deliverables with versioned role-specific profiles. Keep the deterministic feeder model behind device adapters. Gate release on applicable mandatory cases, independent interoperability and reproducible wire evidence. Implement one profile at a time.

**Alternative considered.** Mock transports and offline captures are useful during development and rehearsal. They provide no conformance evidence for a simulated device.

**Consequences.** Stack selection and normative documents become implementation dependencies. Network isolation must support a local Layer 2 GOOSE segment. Graphics work may proceed independently of protocol integration. This decision supersedes the protocol deferral in ADR 0003. The deployment topology remains proposed.
