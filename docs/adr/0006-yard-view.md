# ADR 0006 — Render the yard with fixed inspection viewpoints

**Status:** Accepted

**Decision.** Project a small 3D yard onto Canvas using overview, breaker and relay-cabinet viewpoints. Read equipment state from the station model and bundle the same code into the offline HMI.

**Alternatives considered.** A first-person WebGL scene would support free movement and require more rendering and navigation code. A static illustration would omit changes in viewpoint and equipment indication.

**Consequences.** Learners can inspect three views offline. Free movement, imported 3D assets and additional bays would require a later decision.
