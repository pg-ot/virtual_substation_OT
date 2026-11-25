# ADR 0009 — Use native SCADA drivers and an independent feeder IED

**Status:** Accepted device roles. The SCADA candidate and Unity choice are superseded by [ADR 0010](0010-open-source-stack.md).

**Context.** The simulated bay needs protection and control behavior typical of a substation. The operator SCADA needs IEC 61850 MMS and IEC 60870-5-104 connectivity.

**Decision.** Run protection logic, trip latching, interlocks and control authorization in the simulated feeder IED. The C++ process provides simulated measurements and receives simulated actuator requests over an internal interface. The IED exposes a native IEC 61850 MMS server and publishes GOOSE for a peer IED. The station gateway reads the IED as an MMS client and exposes IEC 104 as a controlled station. Use the same SCADA platform for the station MMS-client view and the control-centre IEC 104 controlling-station view, with distinct connections and data sources. Preserve DNP3 as the alternate supervisory configuration.

**First SCADA candidate.** Siemens SICAM SCC with SICAM IEC Communication Suite. Siemens documents direct IEC 61850 device connectivity and IEC 104 station-controller connectivity. Confirm the exact supported version, driver entitlements, deployment requirements and declared reporting/control compatibility before committing. [Siemens application note](https://cache.industry.siemens.com/dl/files/953/109805953/att_1092562/v1/APN_092_SICAM_SCC_Multiclient_functionality.pdf) · [Siemens communication component manual](https://cache.industry.siemens.com/dl/files/817/109756817/att_987825/v1/scc_b.pdf)

**Alternative considered.** Carrying OpenPLC and Modbus over from the chemical plant would add an extra control and data-mapping layer. Scada-LTS was inherited from the reference deployment; the selected SCADA must demonstrate both required native drivers.

**Consequences.** This supersedes the OpenPLC, Modbus and Scada-LTS portions of ADR 0008. The C++ simulator, Unity WebGL yard and Compose orchestration of simulator services remain the target. Validate station reporting and control over MMS and supervisory synchronization over IEC 104 before accepting a SCADA product. Install a commercial SCADA on its supported host if required.
