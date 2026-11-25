# ADR 0023 — Render the F01 process yard from live SIMF01 feedback

**Status:** Accepted for the container bench.

## Context

The process fixture already publishes real simulated 52a and 52b values, feeder current and source voltage. A walkable view can make an interrupted feeder and a failed breaker easier to distinguish.

## Decision

Serve an original Godot 4.6.3 WebGL Compatibility export at `/yard/` on the SIMF01 web port. Keep the C++ process fixture authoritative. The browser reads SIMF01's existing same-origin state endpoint and supplies its verified readings to the scene. A closed or stuck breaker retains its confirmed indication. An open breaker follows 52a and 52b. Conflicting or unavailable contacts hide the position indicator and show the reason.

The scene provides yard and breaker viewpoints, walk starts at the entrance and inside the control room, and inspection cameras for its protection, bay control, and process I/O cabinets. The room represents secondary panels for the outdoor primary plant. The plant model uses SIMF01 measurements and contacts. The cabinet and sidebar read PRF01 current and trip and BRF01 position and operation failure through a separate read-only yard indication feed. Missing or stale IED feedback is shown with its quality. The page continues to show indications beside the viewport if WebGL initialization fails.

## Alternatives and consequences

Building the yard into the station HMI would couple two separate device views. Running a physics model in the browser would give the bench a second source of breaker state. The chosen approach serves the visual model directly from SIMF01 and leaves the station HMI on its own net and port.

Compose ships a compressed, single-threaded Godot Web export with the engine notices. Developers use the pinned engine and export templates to regenerate it after scene changes. See the [container bench guide](../container-bench.md).
