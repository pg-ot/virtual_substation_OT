# Containerized SS-01 bench

The [SS-01 architecture](ss01-architecture.md) maps the current Compose deployment and target system to the station, bay and process levels.

See the [F01 technical validation](f01-technical-validation.md) for the measured signal path, tested scenarios, and open acceptance items.
Use the [IEC 61850 implementation checklist](iec61850-implementation-checklist.md) to plan GOOSE, Sampled Values and MMS verification.

Use a running Linux Docker Engine with the Docker Compose plugin. Run these commands from the repository root.

```sh
docker compose config --quiet
docker compose build plant
docker compose up -d --wait
node containers/smoke.mjs
```

The `plant` build creates the common image used by all services. Open the HMI at `http://127.0.0.1:8080/`. Set `LAB_HMI_PORT` to override the host port. View the control centre stream with `docker compose logs -f control-centre`.

The station toolbar's **Lab overview** opens an architecture map at
`/lab-overview`. Its asset links open the configured loopback ports in new
tabs. Service endpoints are checked from the station HMI container and do
not prove page rendering, host-port access, protocol health, or breaker operation. Optional
services can appear unavailable when they are not running. Bay indications
retain MMS quality and source time; the breaker position is BRF01
contact-derived feedback. The page identifies the configured plant MMS,
direct HTTP, or experimental SV input profile. It is unavailable when the
station HMI is stopped. Rebuild and recreate the HMI to deploy source changes;
do not recreate a running bench without operator approval.

### Packet capture from the lab overview

The capture controls use a separate host-side agent, not a Docker socket
mounted into the HMI. Install Node.js 20+, ensure the Docker CLI can access
the intended engine, and make the existing `ss01-kali:dev` image available
locally with `tcpdump`, `ip` and `mergecap`. From this repository on the
Docker host, run the agent in a terminal:

```text
node containers/capture-agent.mjs <compose-project-name> <hmi-port> 34090
```

For example, `node containers/capture-agent.mjs ss01-lab-overview 8080 34090`
targets only that Compose project. The agent binds `127.0.0.1:34090`; use
`http://127.0.0.1:34090/lab-overview` for the capture-enabled overview
without recreating the existing HMI. It obtains readings and asset configuration
from the specified running HMI and links back to its station page. An updated
HMI image also displays the controls at its normal `/lab-overview`; set
`LAB_CAPTURE_AGENT_PORT` to the agent port before starting that HMI. The agent
only accepts browser control requests from its own loopback origin or the
configured `127.0.0.1` HMI origin. Use it only on a trusted local machine:
the host user running it can access Docker, and this is not authentication
or a multi-user security boundary. Do not expose it through a proxy or publish
it on other interfaces.

Select one discovered **interface**, all discovered interfaces on one
**network**, or **all lab networks**, and a 10, 30 or 60 second maximum.
Stop early if needed. The agent starts temporary capture containers in the
selected project endpoints' network namespaces, with a 10,000-packet limit
per interface. It removes those containers when they exit. The page links to
per-interface PCAPs, a combined PCAPNG when there is more than one, and a
manifest with interface start/end times, capture statistics and errors.
Files are retained under `outputs/captures/<capture-id>` and the latest
completed capture remains available after an agent restart. They may contain
sensitive data and grow over time; the operator controls retention and access.

These are **endpoint** captures, not a promiscuous bridge tap: switched
unicast traffic may be missed if neither endpoint is captured. Network and
lab scopes combine endpoint files, so they can contain duplicate packets,
different start/end times and partial TCP sessions. Capturing itself consumes
CPU, disk and network resources and can alter observed timing. Open individual
files when combined duplicates confuse stream decoding. MMS may need a fresh
association and TCP 8102–8104 decoded as TPKT; do not restart an active device
just to force decoding. A capture showing no protocol is not proof of no
traffic elsewhere. No timing or conformance guarantee follows.

For the supervised direct-HTTP practical, the
[facilitator guide](training-facilitator.md#session-2--practicals-2a2g)
describes holding 250 A and using the overview's displayed read-only
`station-client read` command to capture fresh MMS associations after the
trip. Select all networks for the same-event MMS, GOOSE and IEC 104
exercise; the command runs on the Docker host and does not restart the HMI.
Use only a disposable project and apply 120 A before the instructor reset.

Lab containers use Docker's `json-file` rotation: three files of approximately
10 MB per container. Old log entries are discarded as files rotate; export
evidence before it expires. Kali's supervised process output also goes to
the container log rather than separate Supervisor log files. The limits do
not cover captures, named volumes, Docker images, build cache, Docker Desktop
logs or other host files, and Docker can exceed a size limit for an individual
log entry. Existing containers must be recreated for the logging settings to
take effect; this interrupts the bench and requires operator approval. The
change does not reclaim existing disk space immediately.

Each container serves its own page at its assigned host port.

| View | URL | Port override |
|---|---|---|
| Station HMI | `http://127.0.0.1:8080/` | `LAB_HMI_PORT` |
| SIMF01 process simulator | `http://127.0.0.1:8081/` | `LAB_PLANT_WEB_PORT` |
| PR-F01 protection IED | `http://127.0.0.1:8082/` | `LAB_PROTECTION_WEB_PORT` |
| BRF01 breaker control IED | `http://127.0.0.1:8083/` | `LAB_BREAKER_WEB_PORT` |
| GW-01 IEC 104 gateway | `http://127.0.0.1:8084/` | `LAB_GATEWAY_WEB_PORT` |
| CC-01 IEC 104 control centre | `http://127.0.0.1:8085/` | `LAB_CONTROL_CENTRE_WEB_PORT` |
| GW-01 DNP3 gateway | `http://127.0.0.1:8086/` | `LAB_DNP3_GATEWAY_WEB_PORT` |
| CC-01 DNP3 control centre | `http://127.0.0.1:8087/` | `LAB_DNP3_CONTROL_CENTRE_WEB_PORT` |

The DNP3 ports are published when the `dnp3` profile is active.

SIMF01 also serves the [3D switchyard and control room](http://127.0.0.1:8081/yard/) on its own port. Choose **Room overview**, jump to an individual panel, or use **Walk from entrance** and go through the open door. In either walk view, drag to look, move with WASD or the arrow keys, and use Q/E to turn. Touch users can drag and hold the on-screen movement buttons. **Reset position** returns to the starting point for that walk view.

Both SIMF01 pages provide **Apply SIMF01 fault** and **Clear SIMF01 fault**. In the base plant-MMS profile, the plant reports 1200 A while 52-F01 is closed. PRF01 detects the current and sends its trip over Layer 2 GOOSE. In direct HTTP mode, use the station HMI input panel to apply PRF01 current separately. Clear the plant fault before reset. Clearing current or fault leaves the protection latch set.

The room contains the F01 protection, bay control, and process I/O secondary panels. The outdoor yard shows the 11 kV source, three breaker poles, feeder current transformers, and outgoing conductors. Panel and yard indications share the SIMF01 state endpoint. The source bus voltage stays upstream of the breaker, while the feeder current follows the downstream process. The protection cabinet shows process inputs and marks relay trip status unavailable because SIMF01 does not receive it. Equipment footprints and room dimensions are representative of the simulated bay.

The image build verifies the six pinned native dependency archives. It uses files already in `containers/deps/archives` and fetches only missing archives. CMake then configures and builds from the verified sources with dependency downloads disabled. If the Docker build network cannot reach GitHub, populate the cache from a host with access and CMake 3.24 or later:

```sh
cmake -P containers/deps/prepare.cmake
docker compose build plant
```

The Docker base image and Debian build packages are separate dependencies.

For the DNP3 pair alongside IEC 104, start and test a fresh bench with:

```sh
docker compose --profile dnp3 up -d --wait
node containers/smoke.mjs --dnp3
```

Use Node.js 20 or newer on the host for the smoke script. It expects a fresh CLOSED fixture, attaches to the simulator and IED consoles, checks the HMI through the published host port, verifies supervisory telemetry, then leaves the fixture running in the failed-to-open condition. Use `docker compose --profile dnp3 down` and `docker compose --profile dnp3 up -d --wait` to create a fresh fixture. Omit `--profile dnp3` for the default stack.

## Linux station GOOSE

The default deployment uses the isolated Compose station network and discovers each IED's station Ethernet interface from its station listener address. The image enables Layer 2 GOOSE and grants `NET_RAW` to the protection and breaker containers. Run the check on a fresh isolated Linux Docker bench.

```sh
docker compose --profile dnp3 build plant
docker compose --profile dnp3 up -d --wait
node containers/smoke.mjs --dnp3
```

The smoke injects the process fault at SIMF01, waits for BRF01 to log the GOOSE assertion, and checks confirmed OPEN and the failed-operation alarm. BRF01 receives no console trip in this mode. Follow the [P1 run sheet](../specs/001-feeder/p1-linux-run.md) for the wire capture, negative control, timing, expiry, and restart cases.

The container image builds libIEC61850 with its multi-threaded MMS server mode:
periodic GOOSE processing then runs separately from MMS connection handling.
It still shares a periodic worker with other server tasks and is not a
dedicated real-time publisher.
The native non-container build retains its upstream default. To reproduce the
previous container configuration, build with
`docker compose build --build-arg LAB_MMS_SINGLE_THREADED=ON plant`.
This change reduces one source of GOOSE retransmission jitter; Docker Desktop
and a general-purpose host do not provide a real-time timing guarantee.
Measured steady retransmission intervals are not trip transfer times or IEC
61850 conformance evidence. Validate the complete protection path, timing under
representative load, expiry and restart behavior separately before relying on
the system.

On 22 November 2026, the tested multi-threaded candidate was deployed to the
live bench with operator approval. The previous image is retained locally as
`ss01-bench:pre-goose-threaded-b2514a0fbc68`. Read-only checks observed clear
revision 3 GOOSE and CLOSED simulated contacts, but preflight still reported
the close-inhibit latch set. No latch reset was issued. See the
[implementation assessment](../outputs/iec61850-implementation-validation.md)
for the scope and remaining acceptance work.

## Kali browser desktop

The optional Kali desktop uses GRFICSv3's Kali/Xfce/noVNC image with Wireshark. It joins the supervisory network, where it can reach the IEC 104 and DNP3 gateways, and a separate internal `kali-wan` bridge. A fixed-destination `kali-access` proxy joins that bridge and the management network and publishes the browser desktop through IPv4 loopback. Startup uses a locally generated VNC password. Both Kali networks are marked internal in the current Compose configuration to restrict external routing. Docker networking alone is not a complete security boundary: the host and published services may remain reachable. Use only a dedicated isolated training environment and explicitly authorized simulated targets. This configuration change is source-only until the Kali service and its network are recreated; it does not change an already running network.

```sh
docker compose -f compose.yaml -f compose.kali.yaml --profile kali up -d --build --wait kali-access
docker compose -f compose.yaml -f compose.kali.yaml logs kali
```

Open [the Kali desktop](http://127.0.0.1:6088/vnc.html) and enter the most recent password printed in the logs. Store it securely when starting Kali: log rotation can remove the startup message, and regenerating the password requires restarting Kali with operator approval. Use `LAB_KALI_WEB_PORT` to override port 6088 if another lab is running. Copy an SS-01 capture into its analysis volume with:

```sh
docker compose -f compose.yaml -f compose.kali.yaml cp <capture-file> kali:/captures/
```

Open the copied capture in Wireshark using **File → Open**. Kali is attached to the supervisory network and can capture traffic visible at its own interface. Station-bus captures are collected on the station interface or at another observation point.

### Student practicals on the Kali desktop

Open **SS-01 Practicals** on the Kali desktop, then a session folder and the
launcher for the workbook activity. **Open practical workbook** opens the
read-only HTML workbook; record answers in the provided Word/PDF workbook or
on paper. There is a launcher for each of 1A-1B, 2A-2G, 3A-3C and 4A-4E.
They provide guided steps; 2C-2E and 2G can open a supplied PCAP/PCAPNG in
Wireshark, and 4B compares a backup's SHA-256 with a separately supplied
fingerprint. The launchers do not save answers.

The materials and workbook are read-only bind mounts from this repository;
they remain available after Kali is restarted or recreated. The rest of the
desktop is not a persistent volume. Copy the relevant **individual**
captures and, for 4B, the approved backup into `/captures` using the `cp`
command above with the correct project name, Compose files and environment.
For example, on the host, replace both placeholders and use the exact
project/overlays selected for the class:

```powershell
docker compose -p <project> -f compose.yaml -f compose.kali.yaml cp "<host-file>" kali:/captures/
```

Provide the `/captures/<filename>` path to the student. The instructor must
ensure files are readable by the `kali` user and communicate the trusted hash
over an independent channel. The project-specific `/captures` volume
persists across container recreation; it is not an immutable backup.
Captures may contain sensitive operational information. Do not copy
credentials. Label historical examples explicitly and do not claim they are
the current exercise.

Kali is not connected to the station or management networks and has no
Docker socket; host `127.0.0.1` URLs do not refer to the host from inside Kali.
The instructor operates the station,
capture agent, optional WireGuard/SSH demonstration and recovery commands on
the host, using authorized projects. The secure-access client is a separate
container, not Kali. Neither fault injection, switching nor restoration is
automated by these launchers. A human instructor rehearsal is still required.

To run focused launcher and helper checks in the running Kali container:

```powershell
docker compose -p <project> -f compose.yaml -f compose.kali.yaml exec -T -u kali kali bash /opt/ss01/practicals/test-activities.sh
```

## Services and networks

| Service | Roles and networks |
|---|---|
| `plant` | SIMF01 breaker mechanism and process I/O on **process** |
| `protection` | PR-F01 reads the plant on **process** and serves MMS on **station** |
| `breaker` | BRF01 receives GOOSE trip on **station**, reads contacts on **process**, and serves MMS on **station** |
| `station-hmi` | Independent MMS client on **station** with browser access through **management** |
| `gateway`, `gateway-dnp3` | Read MMS on **station** and listen for IEC 104 or DNP3 on **supervisory** |
| `control-centre`, `control-centre-dnp3` | Native monitoring masters on **supervisory** |

The three OT bridges are internal. Network-scoped listener aliases bind the native protocol servers to their designated bridge. Each web port maps to IPv4 loopback on the host. Browser pages normally read their own container's `/state` endpoint under a same-origin content security policy. The direct HTTP overlay explicitly allows the HMI browser to send input to the configured PRF01 loopback origin. The station server serves the station single-line and MMS station data. SIMF01 and the IED views read local MMS, GW-01 exposes the values it sends, and CC-01 displays data received by its native master.

### Station HMI breaker control

With the distributed process profile active, select breaker 52-F01 on the single-line to focus its faceplate. The faceplate shows position, quality, source time, phase A current, protection trip and operation failure. Select **Open** or **Close**, then **Execute** in the confirmation dialog to issue IEC 61850 direct control with normal security to BRF01 `XCBR1.Pos`. The HMI waits for newer good-quality contact-derived feedback before showing **POSITION CONFIRMED**. A stuck simulated breaker can accept the request and still return **POSITION NOT CONFIRMED**. Use the station toolbar to inspect the point list or event log.

PRF01 and BRF01 have separate front panels on their device ports. The display keys switch between overview, indications and recent device events. The LEDs show the corresponding native link, trip, position and operation-failure states.

To close after startup or a protection trip, clear the simulated fault and reset PRF01 if it tripped. On the station faceplate, choose **Reset latch**, wait for **LATCH RESET CONFIRMED**, then choose **Close**. The reset is a separate native MMS command with independent BRF01 latch feedback. BRF01 uses the live deasserted GOOSE stream as the protection clear permissive. Station control is available on the loopback web endpoint. The IEC 104 training path supports monitoring and supervised simulated switching; DNP3 provides monitoring only. See [ADR 0029](adr/0029-remote-switching-boundary.md) for the control boundary and outstanding acceptance.

The Compose training profile enables the IEC 104 gateway handler and the
control-centre panel together by default. Set `LAB_IEC104_CONTROL=0` before
creating the services to disable both; `1` enables them. On the control
centre, select **Open** or **Close** and confirm the simulated command.
Verify separate good-quality position feedback. Latch reset remains a
station operation, not an automatic side effect of remote close. The
simulation has no production authentication or control authority and must
remain on a trusted isolated host. Source changes do not update existing
containers: rebuild and recreate only the intended project during an
approved maintenance window, using its actual Compose files and image tag.

### Direct HTTP process-input exercise

For slider/sequencer exercises without SV scheduling, use the direct HTTP
input overlay in a separate Compose project. On Windows PowerShell, assign
that project and distinct loopback ports (change them if any are already in
use); keep these environment variables set while running both Compose and
the smoke script. The smoke script injects current and trips the simulated
breaker; use it only on a fresh isolated fixture, not an operating bench.
The build uses the common `ss01-bench:dev` image tag, so coordinate rebuilds
with anyone using that tag; existing containers are not updated until recreated.

```powershell
$env:COMPOSE_PROJECT_NAME = 'ss01-http-input'
$env:COMPOSE_FILE = 'compose.yaml;compose.http-input.yaml'
$env:LAB_HMI_PORT = '32880'
$env:LAB_PLANT_WEB_PORT = '32881'
$env:LAB_PROTECTION_WEB_PORT = '32882'
$env:LAB_BREAKER_WEB_PORT = '32883'
$env:LAB_GATEWAY_WEB_PORT = '32884'
$env:LAB_CONTROL_CENTRE_WEB_PORT = '32885'
$env:LAB_DNP3_GATEWAY_WEB_PORT = '32886'
$env:LAB_DNP3_CONTROL_CENTRE_WEB_PORT = '32887'
docker compose --profile dnp3 up -d --build --wait
node containers/http-process-input-smoke.mjs
docker compose --profile dnp3 down
```

The browser posts phase-A RMS current to the station HMI's same-origin
`/process-input` route. The station forwards it to PRF01 over the Compose
management network and returns the relay's result. A new Apply takes
control from any other station tab. The station rejects renewals from the
previous tab. The slider accepts 0–1200 A. The sequence applies 120 A,
then 250 A (above the default 200 A pickup), then returns to 120 A. Returning
to normal current does not reset a latched trip. While the panel is open it
renews the input lease; if updates stop for 3 seconds, PRF01 marks the
measurement invalid and blocks reset until fresh input and plant status are
available. SV and HTTP process-input modes are mutually exclusive.

BRF01 remains the GOOSE trip subscriber. Its contact-confirmed breaker
position is read from the BRF01 MMS server by the station HMI and gateways;
IEC 104 and optional DNP3 carry their configured remote indications. The
display does not infer breaker position from the trip bit.

This HTTP path is an explicit simulation interface, **not an IEC 61850
process-bus protocol or standards-conformance test**. The station accepts
same-origin submissions from its IPv4 loopback address. PRF01's HTTP
diagnostics remain available on the loopback port. Its process-input route
accepts writes from the station on the Compose management network. Keep these
ports on an isolated training host. Capture browser HTTP on the station
port or forwarded HTTP on the Compose management network (port 8090). Do not
combine this overlay with `compose.sv.yaml`. Keep this project isolated from
`ss01-bench` when testing; `docker compose down` with the same project and
file options removes only the HTTP-input trial.

The source includes faceplate guidance for a set close latch while the
breaker is CLOSED; it requires a rebuilt image and HMI redeployment to appear
on the bench. Reset requires OPEN feedback and clear protection; follow the
authorized switching procedure. The message does not replace the breaker
IED's interlock checks or authorize an operation.

The source also supports configurable training pickup and delay; see the
[native settings](../native/README.md#training-protection-settings). These
source changes are not part of the deployed candidate above.

## Manual exercise

Attach in separate terminals using these commands. Ctrl+C exits the local client with signal forwarding disabled. The native programs read commands from their container's standard input.

```sh
docker attach --sig-proxy=false $(docker compose ps -q plant)
docker attach --sig-proxy=false $(docker compose ps -q protection)
docker attach --sig-proxy=false $(docker compose ps -q breaker)
```

1. Enter `fault` at the plant. Confirm PRF01 asserts trip and BRF01 opens automatically over GOOSE. Read the contacts with `docker compose exec -T plant plant-read`.
2. Enter `clear` at the plant. After PRF01 logs fault clearance, enter `reset` at PRF01. Use the station faceplate to reset the latch and close BRF01.
3. Enter `stuck` and `fault` at the plant. Read confirmed CLOSED and `operation_failure=1` with `docker compose exec -T breaker breaker-read`.

GOOSE timing, expiry, restart behavior and Sampled Values retain separate acceptance gates.

## Switchyard development

The original Godot 4.6.3 scene is in `yard/`. The Compose image serves the bundled Web export from `web/yard/runtime/`. The Docker build uses those files directly.

Install the matching Godot Web export templates to change the scene. Export the **Web** preset as `yard.html` into a build directory outside the Godot project, then package the runtime with the matching Godot `LICENSE.txt` and `COPYRIGHT.txt` files:

```sh
godot --headless --path yard --export-release Web /absolute/path/to/export/yard.html
node yard/package-web.mjs /absolute/path/to/export /absolute/path/to/godot-notices
node yard/tests/telemetry.test.mjs
godot --headless --path yard --script res://tests/check_scene.gd
```

The yard marks unavailable or contradictory contacts explicitly. It reads its own container's `/state` API. Scenario input remains in the existing simulator and breaker bench consoles.

## Native endpoint overrides

| Variable | Purpose |
|---|---|
| `LAB_BIND_ADDRESS` | Native process listener address, or DNP3 master local bind address |
| `LAB_MMS_HOST`, `LAB_BREAKER_MMS_HOST`, `LAB_PLANT_MMS_HOST` | PR-F01, BRF01, and SIMF01 MMS peer addresses |
| `LAB_IEC104_HOST`, `LAB_DNP3_HOST` | Gateway address for the corresponding master |
| `LAB_IEC104_TIMEZONE` | Optional IANA timezone for IEC 104 CP56Time2a wire timestamps; empty uses UTC |
| `LAB_HMI_BIND_ADDRESS` | HMI listener address inside its runtime |

Existing native port overrides remain available. Native callers default to loopback with address overrides unset. The container entrypoint resolves `LAB_BIND_NAME` to a numeric address for the chosen network. Compose passes peer aliases separately.

The IEC 104 gateway and master must use the same `LAB_IEC104_TIMEZONE`.
CP56Time2a does not carry a timezone; configure external peers to interpret it
the same way. On Linux, set an installed IANA timezone such as `Asia/Kolkata`
in a local Compose `.env` file to send local civil time; leave it unset for
the original UTC wire convention. Changing the host timezone does not
automatically update this setting. Source times remain absolute Unix times
inside the application. An invalid or unavailable timezone prevents startup.
The IANA timezone option is currently supported on Linux only.

The DNP3 master performs LAN time synchronization when the outstation requests
it, using the master's system clock. This does not synchronize the host clock
to an external time source or establish station-wide clock accuracy.
