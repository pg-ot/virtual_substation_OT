# ADR 0010 — Require an all-open-source runtime and build toolchain

**Status:** Accepted architecture. Dependency versions and interoperability remain to be verified.

**Decision.** Use the existing original HTML/CSS/JavaScript operator HMI as the basis for the project-owned SCADA. Give its backend separate native MMS and IEC 104 client adapters. Use Godot with GDScript and the Compatibility renderer for the walkable WebGL yard. Keep the C++ feeder model, independent protection IED, Nginx and PHP telemetry serving, and Linux containers. Use open-source Docker Engine and Compose on Linux as the reference setup.

| Boundary | Candidate and license |
|---|---|
| IEC 61850 MMS and GOOSE | [libIEC61850](https://github.com/mz-automation/libiec61850) under GPLv3 |
| IEC 104 controlling and controlled stations | [lib60870](https://github.com/mz-automation/lib60870) under GPLv3 |
| DNP3 master and outstation | [OpenDNP3](https://github.com/dnp3/opendnp3) under Apache-2.0. Its upstream is archived. Use as an evaluation candidate and require a maintained fork or an explicit maintenance plan before release. |
| 3D editor and runtime | [Godot](https://godotengine.org/license/) under MIT. Use a [WebGL 2 Compatibility export](https://docs.godotengine.org/en/4.4/tutorials/export/exporting_for_web.html). |

**Alternative considered.** The prior vendor SCADA and Unity editor would fail the open-source requirement. A prebuilt open-source SCADA remains eligible if both native drivers are demonstrably open source and satisfy the station profiles.

**Consequences.** The station SCADA backend must receive samples over MMS, and the supervisory SCADA backend must receive samples over IEC 104. The browser renders these separately. Preserve the direct feeder-to-yard telemetry path. Track licenses for linked code, build tools, container images, fonts and assets. Verify redistribution terms before publishing images. IEC and IEEE standards documents are normative references and may need authorized access. They are not distributed as software dependencies. ADR 0004 conformance and interoperability criteria remain in force.

**Supersedes.** Unity in ADR 0008, the Siemens product candidate in ADR 0009, and the DNP3 candidate in ADR 0007.
