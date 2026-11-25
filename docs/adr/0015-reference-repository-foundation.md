# ADR 0015 — Use virtual_substation_OT as the project repository

**Status:** Accepted for the integration branch.

**Context.** The reference project already provides an understandable lab structure with separate protection and breaker roles. Its desktop panels exchange local data with the original station processes through temporary files. The current substation work adds an engineered native model, supervisory protocols, an offline visual prototype and lab documentation.

**Decision.** Preserve the reference repository's history and origin. Add the current implementation at the repository root under `native/`, `src/`, `web/`, `specs/` and `docs/`. Replace the default protection and breaker launchers with process-backed, independently served browser consoles. Preserve the original examples and GUI source as reference material. The new launchers use the generated feeder configuration and stop only the child they started.

**Consequences.** There is one integration tree for future development. The feeder is the owner of simulated position in this slice. The peer shows position as received data and indicates GOOSE expiry. True separate breaker actuation and feedback ownership, IEC 104 and DNP3 web consoles, and live Linux GOOSE acceptance are outstanding. The browser views use HTTP only to display process data and submit local instructor actions.
