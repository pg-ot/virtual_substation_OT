# Virtual Substation

## Native protocol build

See [native/README.md](native/README.md) for the C++ feeder IED, MMS station client, GOOSE peer, IEC 104 gateway and master, and DNP3 outstation and master. These executables form a native-protocol development slice separate from the temporary device process and offline browser builds below.

## Device process build

From this directory run `node src/run-devices.mjs` with Node.js 20 or later. The launcher starts four child processes and stops them on Ctrl+C.

| Asset | Local console |
|---|---|
| Feeder process 52-F01 | `http://127.0.0.1:8201/` |
| Protection IED PR-F01 | `http://127.0.0.1:8202/` |
| Gateway GW-01 | `http://127.0.0.1:8203/` |
| Supervisory consumer CC-01 | `http://127.0.0.1:8204/` |

After CC-01 receives a live sample, use a second PowerShell window to run the outage exercise:

```powershell
Invoke-RestMethod -Method Post -ContentType 'application/json' -Uri 'http://127.0.0.1:8203/action' -Body '{"action":"link","available":false}'
Invoke-RestMethod -Method Post -ContentType 'application/json' -Uri 'http://127.0.0.1:8201/action' -Body '{"action":"fault","active":true}'
Invoke-RestMethod -Method Post -ContentType 'application/json' -Uri 'http://127.0.0.1:8203/action' -Body '{"action":"link","available":true}'
```

Pause between requests to inspect the separate consoles. Restart the launcher to restore initial state. The development transport is HTTP/JSON. See [ADR 0012](docs/adr/0012-standalone-device-processes.md).

## Offline prototype

The target runtime uses the Fortiphyd GRFICSv3 simulation pattern with an [all-open-source stack](docs/adr/0010-open-source-stack.md), native SCADA drivers and a simulated feeder IED. The [migration plan](specs/001-feeder/grfics-migration.md) uses the offline prototype below as its acceptance baseline.

A GRFICSv3-inspired training simulator for one fictional 11 kV feeder bay. The [device profiles](specs/001-feeder/protocol-profiles.md) define the native IEC 61850, IEC 104 and DNP3 release criteria. Protocol integration is pending.

Run the first acceptance scenario with Node.js (verified on v20.14.0):

```powershell
node src/classroom-demo.mjs
```

The runnable slice covers feeder behavior, relay controls, and supervisory loss and recovery. See the [feature specification](specs/001-feeder/spec.md), [implementation plan](specs/001-feeder/plan.md), [task list](specs/001-feeder/tasks.md), [project principles](constitution.md) and [architecture decisions](docs/adr/README.md).

Run `node src/serve.mjs` and open `http://127.0.0.1:8080` for the station single-line, IED faceplate, control-centre snapshot and event log. Each browser page owns an independent simulation. See [ADR 0005](docs/adr/0005-operator-interface.md) for the interface conventions.

Open `station-hmi.html` directly for the offline lab portal. The navigation opens Station HMI, Switchyard, Feeder IED, Gateway, Control centre and Instructor views within one exercise. Use Instructor to drop the WAN, apply a fault and restore the link. The gateway and control centre retain the last forwarded sample during the outage. This build uses the in-browser simulator. The native protocol services are tracked separately in the task list. Rebuild the offline file after editing the UI with `node src/build-standalone.mjs`.
