# ADR 0014 — Generate the feeder IED model from SCL

**Status:** Accepted for the native development build.

**Reference.** Reviewed pg-ot/virtual_substation_OT at commit `2f77270d8c9db9bcc82724d53fee1fe016bde94e`. Its two independent Tkinter panels let learners follow a GOOSE event from the protection publisher to the breaker subscriber. The native tools exchange Ethernet frames, while the GUI bridge uses temporary files. The upstream README and implementation identify divergence between the declared SCL and transmitted dataset, configuration revision and heartbeat lifetime. [Reference implementation](https://github.com/pg-ot/virtual_substation_OT/tree/2f77270d8c9db9bcc82724d53fee1fe016bde94e)

**Decision.** Compile `native/feeder.cid` into the actual libIEC61850 model during the build. The IED uses this model to serve MMS and publish GOOSE. The peer uses the generated GOOSE control block to configure its expected control reference, dataset name, address and configuration revision. The test asserts the advertised settings over MMS. The integrated libIEC61850 publisher owns retransmission and lifetime timing.

**Consequences.** The device has a versioned engineering artifact and builds fail if the model cannot be generated. Builds need a Java runtime for the upstream model generator. Subscriber point interpretation still has an explicit two-member type contract. Independent schema, interface and on-wire verification remain release tasks. The separate peer currently indicates receipt and expiry. A future breaker IED should expose local actuation outcome independently of both the protection request and the publisher's reported position.

**Classroom acceptance target.** Show the protection operation and breaker feedback as separate indications. Verify that repeated frames do not appear as repeated protection operations, that stopping publication marks the peer data stale at expiry, and that the independent supervisory view retains its last good indication during loss of its own link.
