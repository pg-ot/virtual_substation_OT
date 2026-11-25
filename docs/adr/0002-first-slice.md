# ADR 0002 — Start with deterministic JavaScript modules

**Status:** Accepted · 2026-11-21

**Context.** The operational sequence needs to be executable early on the Windows teaching workspace.

**Decision.** Use dependency-free Node ESM modules with an explicit scenario clock for the first slice. Use scripted events and a simplified current model. Retain the module boundaries when adding browser and container runtimes.

**Alternatives considered.** Opening with distributed containers introduces startup and network troubleshooting before state semantics are verified. A power-flow solver adds modelling effort beyond the single-bay lesson.

**Consequences.** The first slice runs from the command line. It validates the classroom scenario and is unsuitable for engineering studies or real protection settings.
