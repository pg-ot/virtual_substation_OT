# ADR 0030 — Layer 2 GOOSE is required

## Status

Accepted for the SS-01 Compose deployment. This supersedes the earlier default-bench GOOSE configuration decisions in [ADR 0020](0020-compose-bench.md), [ADR 0024](0024-f01-position-alarm-and-trip-profiles.md), and [ADR 0025](0025-station-hmi-breaker-control.md).

## Decision

Build the container image with Layer 2 GOOSE support and configure PRF01 and BRF01 to publish and subscribe on their station network. The ordinary Compose deployment and the SV experiment retain this protection path. Station reset and close require a fresh, clear protection permissive under the breaker interlocks. Protection communication-loss exercises use an isolated, recoverable network or publisher interruption while GOOSE remains configured. Restore the affected service or network after each exercise.

## Evidence and outstanding work

The Compose image enables `CONFIG_IEC61850_L2_GOOSE`, and the IED services use `LAB_STATION_GOOSE=1` with raw-socket capability. The [GOOSE timing report](../../outputs/goose-timing-variation-report.md) and [training readiness tracker](../training-readiness.md) record observed traffic and interlock tests. Further timing, reliability and independent conformance acceptance remain open.

The revised protection dataset carries `PTRC1.Tr.general` and `PTRC1.Tr.q`, with configuration revision 3. PRF01 marks trip quality invalid when its selected process current is unavailable. BRF01 treats a received non-good protection quality as an unavailable permissive. A quality recovery produces a fresh usable permissive. Revision 3 changes the GOOSE dataset and requires the publisher and subscriber to be deployed together.

An isolated test interrupted PRF01's process network while leaving its station GOOSE path active. The station reported invalid trip and current quality, BRF01 logged invalid GOOSE quality and rejected a close request, and a close succeeded after process connectivity recovered. A subsequent automatic-trip and stuck-breaker acceptance passed. The [capture](../../outputs/goose-quality-transition.pcap) contains 25 readable GOOSE frames with zero reported capture drops. Wireshark decoded two dataset entries at revision 3 and observed quality bit strings `0000`, `4000` and `0000` across state numbers 12, 13 and 14. The [regression](../../containers/goose-quality-smoke.mjs) repeats the process-network interruption and restores it after the test. This is project-peer evidence, with independent interoperability and protocol conformance still open. The running training stack uses the earlier image until redeployed.

The GOOSE injection fixture accepts both tagged frames and Linux cooked captures where the VLAN header is absent. For the latter it reconstructs the priority 4, VLAN ID 0 header configured in this project's SCL. A revision 3 frame from the quality capture was modified and transmitted on the isolated validation network. The receiver was not running in that fixture check, so it verifies capture parsing and frame emission only.

In a subsequent isolated receiver test, a revision 4 asserted-trip frame left the open, unlatched breaker unchanged while the revision 3 clear stream continued. A revision 3 clear frame carrying invalid quality and a higher state number was accepted as an invalid protection indication. Station close was rejected and BRF01 remained OPEN. The receiver then reported stream expiry and resumed the original revision 3 clear stream, after which close succeeded. The injected frame affected sequence tracking until expiry. This exercise does not establish source authentication, replay resistance or independent conformance.

Another isolated test injected a revision 3 asserted-trip frame with a 12-bit quality field. BRF01 remained CLOSED and unlatched while valid revision 3 clear messages continued to be received. This exercises rejection of that malformed field length; it is not exhaustive malformed-message testing.
