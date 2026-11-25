# ADR 0001 — Separate process state, protection and supervision

**Status:** Accepted · 2026-11-21

**Context.** The yard and station need to reflect physical state while the control centre can retain stale information. [GRFICSv3 reference](https://github.com/Fortiphyd/GRFICSv3)

**Decision.** The feeder owns breaker state and simulated measurements. The IED owns the latch, control mode and operation authorization. The gateway owns its received snapshot and command eligibility. A yard renderer reads process and relay feedback. A control-centre renderer reads only gateway telemetry.

**Alternative considered.** A single shared state store read by every display would simplify wiring and bypass the communications behavior under study.

**Consequences.** The same breaker can legitimately have different indications across views during an outage. Each view must label quality and timestamps.
