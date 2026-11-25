# ADR 0021 — Serve component views from one browser origin

**Status:** Superseded by [ADR 0022](0022-dedicated-component-web-ports.md).

## Context

The reference lab gives each asset its own view. SS-01 needs those device-specific views and an explicit boundary between browser pages and native devices.

## Decision

The station HMI serves the single-line and separate component pages at one origin. Each browser page uses a relative, read-only HTTP API on that server. The server accepts known component IDs and reads the corresponding backend on the management bridge. A content security policy limits browser connections to the same origin.

SIMF01, PR-F01, and BRF01 use native MMS readback for their faceplates. Gateway panels show the point values and quality presented to their supervisory stacks. The control-centre panels are fed by callbacks in the actual IEC 104 and DNP3 master sessions. The native systems keep their process, station and supervisory protocol links. Management HTTP listens on its designated interface.

## Alternatives and consequences

Separate host ports per asset would give each device an entry point, with more Docker port mappings and browser origins to manage. One origin provides direct links to individual views and a consistent navigation bar. The station shutdown, faults and local controls remain exercisable through the native bench consoles; web command delivery is a separate control milestone. Only the station HMI port is published.
