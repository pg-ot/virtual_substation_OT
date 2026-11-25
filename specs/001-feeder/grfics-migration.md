# GRFICSv3 stack migration

| Order | Implementation | Acceptance |
|---|---|---|
| 1 | Port the feeder process model to C++. Publish confirmed breaker position, bus voltage, feeder current and physical fault over an internal JSON interface. Include a source time and sequence. | Run the same known initial, loaded, faulted, open and restored states as the JavaScript fixture. |
| 2 | Connect the simulated feeder IED to the C++ process through an internal interface. Model local/remote selection, interlocks, trip latch and simulated actuator requests. Expose the station model through native IEC 61850. | Verify that position feedback is separate from the command result and that local protection continues during loss of supervisory communications. |
| 3 | Serve an original Godot WebGL export through Nginx. Use a read-only PHP telemetry bridge. Bind the breaker indicator and relay lamp to confirmed feedback. | Walk from an overview into the breaker and relay areas. Observe local equipment feedback during the outage and trip exercise. |
| 4 | Extend the original HMI with an open-source backend using native MMS-client and IEC 104 controlling-station drivers per ADR 0010. Use separate data sources for station and supervisory displays. | Verify MMS reporting and controls, IEC 104 interrogation and spontaneous updates, then replay disconnect, trip and reconnect. The supervisory view holds the last sample and blocks commands until refreshed. |
| 5 | Deploy the IEC 61850 station interfaces and independent client/subscriber tests. Add IEC 104 and DNP3 supervisory configurations. | Apply the versioned profile gates in [protocol-profiles.md](protocol-profiles.md) and archive wire evidence. |

## Host readiness

The reference deployment is open-source Docker Engine and Compose on Linux. Verify the Linux engine, C++ compiler and Godot Web export tooling on the reference host before running acceptance checks.
