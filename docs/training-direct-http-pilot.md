# F01 direct-HTTP training pilot

This is a supervised simulation exercise, not a protection-system or
standards-conformance demonstration. The pilot uses browser-supplied PRF01
phase-A current, GOOSE trip to BRF01, contact-derived position over MMS and
IEC 104 monitoring and supervised simulated switching, and optional DNP3
monitoring. It does **not** use SV or reverse breaker-position GOOSE.
A human instructor must supervise and verify the actual indications.

## Preparation

1. Use a dedicated local training host with Docker and the intended project
   running. Record the exact project, image, overlays and port overrides;
   never operate a project in use by another class. For the previously
   documented `ss01-lab-overview` instance, open
   `http://127.0.0.1:8080/` for station SCADA and
   `http://127.0.0.1:34090/lab-overview` for the capture-enabled overview.
   The overview links to device and supervisory pages. These addresses are
   local to the host, not remote-trainee URLs.
2. Keep **one controlling station page** open. In its direct PRF01 process
   input panel select 120 A and choose **Apply slider value**. Wait for
   accepted input and GOOD current and trip quality. The page renews a
   three-second lease only after Apply; closing, reloading, suspending or
   losing the controlling page can invalidate the input. Reapply and verify
   if that happens. An explicit Apply transfers control to that tab.
   A tab that loses control stops renewing its previous value.
   The station forwards current to PRF01, so the controlling page only
   needs access to the station's own address.
3. Check SIMF01 fault is clear and confirm the station shows CLOSED, 120 A
   GOOD, trip CLEAR GOOD, latch CLEAR GOOD and operation failure CLEAR GOOD.
   Check position, trip and current at both available remote masters. If
   not at baseline, use the recovery below; do not infer a healthy state from
   an old value with invalid quality. A reachable page or a previous
   successful rehearsal does not prove that the current state is ready.

## Guided exercises

| Exercise | Action | Expected observation |
|---|---|---|
| Switching | Open, then reset the breaker latch if set, then close using the HMI confirmations. | BRF01 reports contact-confirmed OPEN then CLOSED. In HTTP mode PRF01 current **stays at the injected 120 A** unless the operator changes it; SIMF01 current follows its own breaker model. |
| IEC 104 switching | With instructor authorization, use the control-centre page to open and close; verify the protection permissive and close latch before closing. If required, reset the latch separately at the station. | Record the select/execute exchange and command result, then independently verify good-quality contact-derived position. A rejected or unconfirmed operation must not be automatically retried. |
| Protection | From the closed baseline, run the **120 → 250 → 120 A** sequence and accept the simulation prompt. | At default 200 A pickup PRF01 asserts trip, GOOSE causes BRF01 to open, and position and trip reach both masters. On return to 120 A, trip remains latched and the breaker stays OPEN until recovery. The sequence may behave differently if pickup is customized. |
| Packet evidence | Start a station-interface, network, or whole-lab capture before the sequence. Download the files and manifest after it ends. | GOOSE is visible where the selected endpoint sees it; supervisory endpoint files can show IEC 104 and DNP3. MMS may require a captured association and decode-as TPKT on ports 8102–8104. Combined captures can duplicate packets and do not guarantee full network coverage. |

SIMF01 fault buttons change the plant, **not** the HTTP current sent to
PRF01. The plant-MMS failed-opening, fault-current and reset worksheets are
not interchangeable with this exercise. Experimental SV and the isolated
configuration recovery drill require separate preparation. DNP3 control is
not implemented.

## Recovery after a protection trip

Keep the controlling page open, apply 120 A, and verify the current readback.
Confirm the plant fault is clear. On the breaker faceplate, use **Reset
PRF01 trip** and wait for clear trip feedback. Use **Reset BRF01 close latch**,
then **Close** and confirm the position.

The station displays PRF01's pickup setting. At the default 200 A pickup,
182 A is below pickup and 580 A is above it. The downstream CT on the
single-line shows SIMF01 feeder current, which is zero with the breaker
open. The PRF01 HTTP test input is shown separately.

On the Docker host, an instructor can use the existing project-specific
workflow from the repository root in PowerShell:

```powershell
$env:COMPOSE_PROJECT_NAME = 'ss01-lab-overview'
$env:COMPOSE_PROFILES = 'dnp3'
node containers/instructor.mjs reset
```

This command changes the selected simulation: it clears plant fault,
restores the mechanism, resets PRF01, resets the BRF01 latch and closes
when permitted. It expects a normal 120 A input kept alive by the HMI and
verifies plant, station and running remote baseline indications. Stop if it
fails or input quality becomes invalid; investigate instead of bypassing
interlocks. For another project set its exact name and matching Compose
configuration before running the command.

## Before a class

An instructor should personally rehearse the steps, verify all page links,
capture downloads and recovery, and explain polling delays, possible packet
loss and the input lease. The laboratory has no demonstrated real-time timing,
independent interoperability, production remote-access security or formal
conformance. See the [four-session facilitator guide](training-facilitator.md)
for the preflight, teaching flow, timetable and answer guidance.
Keep the exercise on a trusted isolated host and protect captured traffic.
See the [scenario test cases](scenario-test-cases.md) and
[validation report](../outputs/scenario-validation-20261123/report.md) for
tested and untested cases.
