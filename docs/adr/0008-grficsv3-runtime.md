# ADR 0008 — Use the Fortiphyd GRFICSv3 runtime stack

**Status:** Partially superseded by [ADR 0009](0009-native-scada-and-ied.md).

**Context.** The owner requested the same technology stack and operator experience as Fortiphyd GRFICSv3. The current offline HMI validates operating semantics and is the baseline for the migration.

**Decision.** Deliver the substation as Linux containers under Docker Compose. Use C++ for the process model, an original Unity WebGL yard served by Nginx, and a PHP-to-local-JSON interface for yard telemetry. Use OpenPLC v3 and IEC 61131-3 Structured Text for simulated bay logic. Use Scada-LTS with seeded project data for the operator views. Reproduce the workflow of moving between the walkable process view, station single-line, device controls, events and separate instructor actions. Use original yard assets, interface styling and equipment identifiers.

**Protocol boundary.** Use the GRFICSv3 remote-I/O pattern for the internal process-to-controller link, with a Python Modbus adapter if needed for OpenPLC. Modbus mapping is internal to the simulation. External station device interfaces still require native IEC 61850 MMS and GOOSE. The gateway and supervisory clients still require IEC 104 and DNP3 profiles. ADR 0004 governs their acceptance.

**Alternatives considered.** Extending the Node/Canvas build would preserve its ease of distribution but move the operational simulator away from the requested stack. Importing the upstream chemical-plant scene and control project would introduce assets and logic for a different process.

**Consequences.** This supersedes ADRs 0002 and 0006 for the target runtime. The existing standalone HTML remains a usable offline prototype. Development needs the Unity editor with WebGL build support, a C++ build environment and a running Linux Docker engine.

References: [Upstream Compose](https://github.com/Fortiphyd/GRFICSv3/blob/main/docker-compose.yml), [simulation image](https://github.com/Fortiphyd/GRFICSv3/blob/main/simulation/Dockerfile), [Unity host page](https://github.com/Fortiphyd/GRFICSv3/blob/main/simulation/web_visualization/index.html), [OpenPLC](https://github.com/Fortiphyd/GRFICSv3/tree/main/plc), [Scada-LTS](https://github.com/Fortiphyd/GRFICSv3/tree/main/scadalts).
