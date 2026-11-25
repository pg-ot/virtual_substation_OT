# ADR 0011 — Serve device interfaces from a shared lab portal

**Status:** Proposed

**Implementation progress.** The offline prototype uses hash navigation and one in-browser exercise state. Its station, IED, gateway and control-centre views render the appropriate simulator snapshots. This establishes the operator workflow. The deployed same-origin routes and service-backed reads are pending.

**Context.** GRFICSv3 uses a plain HTML/CSS/JavaScript launch page with a Unity WebGL process view, a PHP bridge to the simulator's JSON socket and links to independently served tools. Scada-LTS has its own Tomcat web app. Its engineering workstation is a desktop exposed through noVNC and websockify.

**Proposed decision.** Reuse the portal pattern with Nginx as a single browser entry point. Serve original HTML/CSS/ES modules with shared operator display conventions and a Godot WebGL export for the yard. Keep device services behind separate same-origin API routes. Use the existing HMI as the starting point.

| Page | Data source and responsibilities |
|---|---|
| /yard/ | Read-only process and relay feedback drives the 3D indications. |
| /station/ | Its SCADA backend acts as an MMS client. Render the station single-line, point quality, reports and authorized operator commands. |
| /control-centre/ | Its SCADA backend acts as an IEC 104 controlling station and consumes only its own supervisory connection. Display last sample and quality on loss of communications. |
| /ieds/pr-f01/ | The IED management backend exposes its own measurements, trip latch, status and events. Apply local IED authorization to any simulated operation. |
| /gateway/ | Display read-only connection status, source/destination point map, last sample, quality and mapping errors from the gateway. |
| /instructor/ | Provide a separate instructor interface for simulation fault, link state and reset. |

**Data and controls.** Start with JSON snapshots. Return source timestamps and point quality alongside engineering units. Add Server-Sent Events if event streaming is needed. Use explicit command requests with server-side checks and distinct returned operation and equipment feedback. The browser uses HTTP. Backends continue to exchange native MMS, GOOSE, IEC 104 or DNP3 according to their role. Web routing does not provide a bypass around a failed supervisory link.

**Alternative considered.** Serve each device interface on its own port, as upstream GRFICSv3 does for tools. A same-origin portal simplifies classroom navigation and keeps service addressing out of front-end files. Reserve noVNC for a later engineering tool that needs a desktop.

**Acceptance.** Open the station, IED, gateway and control-centre pages concurrently. During WAN loss and a local trip, verify that the yard and IED show the trip, the station receives it over MMS, the gateway identifies the supervisory interruption, and the control centre holds its last IEC 104 values with stale quality. Verify recovery from fresh IEC 104 data.

**Sources.** [GRFICSv3 launcher](https://github.com/Fortiphyd/GRFICSv3/blob/main/simulation/web_visualization/index.html), [simulator web bridge](https://github.com/Fortiphyd/GRFICSv3/blob/main/simulation/web_visualization/data/index.php), [Scada-LTS container](https://github.com/Fortiphyd/GRFICSv3/blob/main/scadalts/Dockerfile), [workstation container](https://github.com/Fortiphyd/GRFICSv3/blob/main/workstation/Dockerfile).
