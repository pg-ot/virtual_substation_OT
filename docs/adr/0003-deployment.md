# ADR 0003 — Isolate lab networks and adapt protocols at the gateway

**Status:** Proposed · 2026-11-21

The protocol scope is superseded by [ADR 0004](0004-protocol-fidelity.md).

**Context.** Fortiphyd separates simulator, control and HMI responsibilities in Compose. The substation needs supervision to fail independently of local protection. [Upstream Compose](https://github.com/Fortiphyd/GRFICSv3/blob/main/docker-compose.yml)

**Decision.** After the visual classroom baseline, distribute the simulator, IED and gateway over internal Compose networks. Attach the gateway to station and supervisory networks. Serve classroom views through loopback. Add IEC 104 behind the gateway boundary once a suitable maintained adapter has been verified.

**Alternatives considered.** A flat network would allow the supervisory client to bypass the gateway. Mirroring the upstream macvlan layout immediately adds host NIC dependencies.

**Consequences.** Validate Docker behavior on the teaching laptop. Verify reachability boundaries and reconnect behavior before accepting this ADR. Keep offline protocol examples available for class.
