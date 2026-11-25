# ADR 0020 — Package the native TCP bench in Docker Compose

**Status:** Partially superseded by [ADR 0030](0030-goose-required.md) for GOOSE configuration. [ADR 0022](0022-dedicated-component-web-ports.md) updates the web port publication. The original decision below records the earlier development bench.

## Context

The Windows bench has exercised independent process, IED, station, and supervisory processes over native TCP. Native listeners and clients started with loopback addresses. Containerized services require separate network addresses and reproducible startup.

## Decision

Run each asset in its own container from one multi-stage image. Attach process, station, and supervisory roles only to the bridges they use. Give each native listener a network-scoped address. Publish the read-only station HMI through a management bridge to host loopback. Run IEC 104 by default and expose DNP3 as an optional Compose profile.

Build the Compose bench with Ethernet GOOSE disabled and preserve BRF01’s explicit injected-trip entry point. A separate Linux Ethernet configuration follows the station and process bus acceptance work. Keep the smoke exercise focused on the existing local MMS and northbound TCP paths.

## Alternatives and consequences

Putting all processes in a shared container could reuse loopback and would conceal the role boundaries that the deployment needs to verify. Separate containers let the smoke check exercise the same interface boundaries as the native architecture. The packaging completes once it builds and the smoke test passes on a Linux Docker Engine. See the [container bench guide](../container-bench.md).
