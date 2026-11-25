# ADR 0022 — Serve each component from its own web port

**Status:** Accepted for the container bench. Supersedes [ADR 0021](0021-component-web-views.md).

## Context

Each simulated device needs a dedicated browser entry point, and the station HMI should serve the station single-line and operator indications.

## Decision

Each device container serves its faceplate, static assets and read-only `/state` endpoint on its own HTTP listener. Compose publishes each listener on a distinct loopback port. The station HMI keeps port 8080 and its own MMS station reader. The process, bay and supervisory services keep their native protocol links.

Each webpage uses relative URLs and a content security policy that limits fetches to its own origin. Shared visual styles are served independently by each container. The DNP3 views and ports are activated with the matching services.

## Alternatives and consequences

ADR 0021 used one published entry point and server-side proxying. The dedicated ports make the association between browser page and container visible in Compose and Docker Desktop. The deployment needs one available loopback port for every active web interface. See the [port map](../container-bench.md).
