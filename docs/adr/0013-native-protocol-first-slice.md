# ADR 0013 — Build native protocol device programs before migrating the consoles

**Status:** Accepted for development.

**Decision.** Pin libIEC61850 1.6.2.1 and lib60870 2.4.1. Use OpenDNP3 3.1.2 as a development evaluation dependency under ADR 0010. Compile separate MMS, GOOSE, IEC 104 and DNP3 roles with CMake and run them directly. The two supervisory gateway variants acquire their points through a real MMS connection. The local feeder fixture lives in the native IED process for this slice.

**Consequences.** The first acceptance step is a native run covering breaker position, trip, current, timestamp/quality transfer and MMS command interlocks. Independent implementations, engineered profiles and binding the browser consoles to native services remain release work. Do not treat a successful exchange between same-library endpoints as independent interoperability or conformance.
