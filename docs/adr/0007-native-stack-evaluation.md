# ADR 0007 — Evaluate native stacks before pinning dependencies

**Status:** Proposed

The DNP3 candidate is superseded by [ADR 0010](0010-open-source-stack.md).

**Context.** Each advertised device role needs independent wire-level acceptance evidence under ADR 0004.

| Protocol | First candidate | Initial acceptance exercise |
|---|---|---|
| IEC 61850 | [MZ Automation libIEC61850](https://support.mz-automation.de/doc/libiec61850/c/latest/) provides MMS client/server and GOOSE publisher/subscriber. | Generate the fixture from versioned SCL, discover the station model using an independent MMS client, and verify breaker position, quality and timestamp after a simulated operation. Then validate GOOSE publication and expiry against an independent subscriber on the isolated station segment. |
| IEC 104 | [MZ Automation lib60870](https://github.com/mz-automation/lib60870) provides CS 104 client/server roles. | Use an independent controlling station for interrogation and spontaneous updates. Disconnect and reconnect while the simulated bay changes state, then verify the refreshed position and command gating. |
| DNP3 | Step Function I/O provides documented [master](https://docs.stepfunc.io/dnp3/1.8.0/guide/docs/api/master/terminology/) and [outstation](https://docs.stepfunc.io/dnp3/1.8.0/guide/docs/api/outstation/overview/) APIs. | Use an independent master to compare the integrity snapshot with buffered events after a connection interruption. Check flags and timestamps against the declared Device Profile. |

**Proposed decision.** Evaluate IEC 61850 first because its station model will supply the gateway mappings for both supervisory protocols. Pin the exact standard edition, test procedure and stack build before running the acceptance suite. Evaluate the upstream licensing terms against classroom distribution before adopting any stack. Select independent peers that use different implementations from the stack under test.

**Alternative considered.** Implementing the wire protocols in the browser model would duplicate stack behavior and make interoperability validation more costly.

**Consequences.** The shortlist is based on documented API capabilities. Reproduce builds and record packet captures, peer configuration and verdicts before accepting any dependency or claiming conformance.
