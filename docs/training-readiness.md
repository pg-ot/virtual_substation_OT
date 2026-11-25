# SS-01 training readiness

This tracker records the agreed pilot and complete-architecture work. A passing functional test applies to the tested configuration and does not establish protocol certification.

The individual observations below describe their dated test/deployment
contexts, not necessarily today's running project. For current source and
the latest documented deployment snapshot, see the [as-built reference](as-built.md).

## Four-session package: 23 November 2026

The revised workbook, presentations and [facilitator guide](training-facilitator.md)
include a held-current packet exercise and supervised simulated IEC 104
monitoring and switching. An isolated same-event capture includes MMS,
GOOSE and IEC 104 evidence; the isolated recovery test also checked remote
open/close after monitoring was restored. These are project-peer and
automated checks, not independent interoperability or human acceptance.

At the earlier read-only check, the shared `ss01-lab-overview` position was
CLOSED/GOOD but trip and current were INVALID after the direct-HTTP input
lease expired. At 09:03 UTC it was rebuilt and the instructor reset and
preflight passed, including both supervisory profiles. See the latest
[deployment snapshot](as-built.md#deployment-snapshot-23-november-2026-0903-utc).
The baseline still depends on the controlling page renewing the input lease.
A human trainee rehearsal and class-time preflight remain required.

## Direct-HTTP pilot check: 23 November 2026

The running `ss01-lab-overview` project was checked with the HTTP input and
both supervisory pairs. An automated browser interaction applied 120 A,
opened the breaker, reset the BRF01 latch and closed it. It then ran the
120 → 250 → 120 A sequence: PRF01 asserted trip, BRF01 reported
contact-confirmed OPEN, and both masters reported OPEN and trip asserted.
With 120 A renewed by the controlling page, the instructor reset command
restored CLOSED, clear trip/latch and good-quality indications at both
masters. A subsequent baseline check remained good over six seconds.

The [rehearsal capture manifest](../outputs/captures/d4378fd104c690dc/manifest.json)
and [combined PCAPNG](../outputs/captures/d4378fd104c690dc/combined.pcapng)
were produced by the capture-enabled overview. Individual endpoint captures
showed GOOSE asserted and clear, IEC 104 and DNP3 values, and HTTP 120/250 A
requests. All 20 capture processes reported zero kernel drops; this does not
prove complete network coverage. Capture files can overlap and may contain
sensitive data.

This is an automated browser-led check, **not** a human-led training rehearsal.
It supports a supervised local pilot using the
[direct-HTTP pilot guide](training-direct-http-pilot.md), not an unrestricted
release or a conformance claim. The active input depends on the controlling
browser page continuing to renew it. A human instructor must rehearse the
exercise, confirm access and baseline at class time, and manage recovery.

| Work | Status | Evidence or remaining acceptance |
| --- | --- | --- |
| Scenario controls and baseline | In progress | Host instructor console and CLI support plant scenarios, IEC 104 gateway loss, baseline verification, and project-tagged history. The reset retry has deterministic interlock tests and the isolated instructor workflow passed after the change. Verify repeated exercises, browser presentation and more failure cases. [Instructor guide](instructor-scenarios.md) |
| Pilot exercises | In progress | Scenario matrix, trainee worksheet and instructor answers are available. Complete the human-led rehearsal and browser walkthrough. [Exercise matrix](training-pilot-exercises.md) · [Worksheet](training-pilot-worksheet.md) · [Instructor answers](training-pilot-instructor-answers.md) |
| GOOSE protection path | In progress | Automatic trip, recovery, stuck breaker, publisher loss, subscriber restart, wrong revision and selected duplicate/lower-sequence and lower-state cases have been exercised. A lower-state acceptance defect was fixed and retested. Captures during current variation and trip/clear transitions show timing jitter, and a repeatable analyzer reports observed continuity and nominal deviations. Independent timing and broader failure tests remain. [Timing evidence](../outputs/goose-timing-variation-report.md) · [Trip-cycle evidence](../outputs/goose-trip-cycle-report.md) |
| Startup and recovery | In progress | The isolated startup-recovery test passed three breaker outages, including HMI startup during one outage, plus protection loss and recovery. An earlier intermittent invalid indication remains unexplained. |
| Browser and device UI | In progress | Headless Chrome rendered the running station HMI, SIMF01, protection, breaker, IEC 104 and DNP3 gateway and master pages at 1440×900 with live baseline values. A low-contrast SIMF01 instruction and wrapping IED point references were corrected and visually rechecked in isolated rebuilt containers. The IED indication table now scrolls horizontally at this viewport. In an isolated software-WebGL browser run, the yard overview, breaker close-up, control room and protection panel rendered with live values. All seven navigation buttons selected and requested their views. Oversized outdoor labels were hidden in the overview and breaker views, with status retained in the sidebar. Keyboard and pointer walking, other view rendering, human-led browser rehearsal and normal GPU rendering remain to be validated. |
| Kali supervisory access | In progress | noVNC returned HTTP 200 and TCP connections to both supervisory gateways succeeded in the isolated and running stacks. On 22 November 2026 a WebSocket client authenticated through the running noVNC proxy using VNC authentication and received an update for a 1280×720 framebuffer. Desktop interaction and a complete browser-led training exercise remain to be verified. |
| Reproducible deployment | In progress | `containers/preflight.mjs` checks the running baseline, recent GOOSE, supervisory paths and yard assets. It passed on the running stack and detected an isolated IEC 104 gateway outage. The IEC 61850 connection capacity was increased after a refused association, and isolated tests with seven additional readers and HMI switching passed. Clean-machine build, image identity and host resource acceptance remain. [Capture follow-up](../outputs/scenario-capture-report.md) |
| IEC 104 and DNP3 | In progress | Monitoring and basic capture validation passed with project peers. Complete device profiles, error and event cases and independent interoperability. |
| Process bus and merging units | In progress | The experimental SV publisher and subscriber produced one successful trip and invalidated current after publisher loss. Sample-counter gaps caused recurring invalid input quality, so reliable operation and timing remain open. Plant MMS and direct HTTP are separate input profiles; the as-built snapshot identifies the selected profile. [SV evidence](../outputs/sv-validation-report.md) · [SV profile](adr/0028-sampled-values-training-profile.md) |
| Engineered protection | Open | Implement and test supported settings, timing and functions. |
| Clock and event time quality | Open | Implement synchronization and holdover model and validate event quality and ordering. |
| Remote switching | In progress | Supervised simulated IEC 104 select/execute and control-centre operation are provided for training. Earlier isolated opt-in tests covered browser open and close, unselected execution rejection and faulted-close negative termination. DNP3 control, production authority, further lifecycle cases and independent interoperability remain open. [Remote switching boundary](adr/0029-remote-switching-boundary.md) |
| Formal protocol conformance | Open | Establish claims and applicable editions, run feature-specific and independent tests and retain results. |

## Recent acceptance

On 22 November 2026 the latest rebuilt image passed the isolated MMS-process pilot checks with Layer 2 GOOSE and both supervisory protocols enabled. `containers/smoke.mjs --dnp3` exercised automatic opening and a stuck-breaker operation failure, including the HMI and both remote views. An instructor reset restored and verified the baseline across the gateways and masters. `containers/instructor-smoke.mjs` then passed fault, reset and IEC 104 gateway-loss recovery and completed its final reset. These are automated checks, not a human-led rehearsal or independent protocol conformance evidence.

The isolated instructor acceptance test passed the baseline, automatic GOOSE trip, reset and IEC 104 gateway loss and recovery with both supervisory protocol profiles active. Run it with `node containers/instructor-smoke.mjs` against the selected Compose project. This test changes the selected simulation and attempts a final reset.

Run `node --test containers/instructor-control.test.mjs` to check bounded retry decisions for rejected close and latch-reset requests. The tests use a local fixture and cover asserted trip, invalid trip quality, closed breaker, invalid latch quality and unconfirmed commands. They do not replace the live GOOSE acceptance test.

The isolated HMI recovery check passed three breaker stop/start cycles and one protection stop/start cycle. Run `node containers/startup-recovery-smoke.mjs` against the selected Compose project. The test deliberately interrupts these devices and attempts to restore them.

On 22 November 2026 the extended recovery check passed isolated breaker and protection stop/start cycles with IEC 104 and DNP3 enabled. Both control centres showed invalid position and close-inhibit quality during each of three breaker outages and recovered good-quality values after restart. The HMI was restarted during one outage. During the protection outage, both masters reported invalid trip and current while retaining good breaker position, then recovered good-quality indications after protection restarted. This exercises the project masters and does not establish independent protocol conformance.

The same isolated regression opened BRF01, reset its close-inhibit latch, stopped PRF01 and waited for the last clear GOOSE permissive to expire. A station close request returned `REJECTED` and the breaker remained OPEN. After PRF01 restarted and the clear protection indication recovered, the station close completed with position confirmed. The test covers this outage and recovery sequence using the project's HMI and IEDs.

The component acceptance additionally attempted station latch reset and close after an automatic trip while the simulated fault remained active. Both requests returned `REJECTED`, and the breaker remained OPEN with the trip asserted. The acceptance then exercised fault clearance, reclose and a stuck-breaker fault. A subsequent instructor reset restored the isolated baseline. The simulated current has a fixed 1,200 A fault value and PRF01 currently uses a fixed 200 A pickup, so this does not establish pickup-boundary accuracy or engineered protection timing.

The revised revision 3 GOOSE dataset carries protection trip quality as well as its Boolean value. An isolated process-input interruption produced invalid protection quality and blocked breaker close while GOOSE continued to flow. Recovery restored a good permissive and allowed close. Details and the packet capture are in [ADR 0030](adr/0030-goose-required.md). This change requires coordinated publisher and subscriber deployment and has not yet been applied to the running training stack.

Run `node containers/preflight.mjs` after resetting the selected stack to check the baseline without deliberately changing its state. DNP3 services are reported as skipped when their profile is not running. Asset availability is an HTTP check and does not establish browser rendering.

The preflight checks a clear, good-quality close-inhibit indication at each running supervisory component and compares each running container's image ID with the image currently referenced by its local tag. It passed on 22 November 2026 in an isolated deployment with both supervisory protocols and the rebuilt image. On the running training deployment it reported missing supervisory latch indications and an older breaker image. A matching local tag does not prove that an image includes the latest source or establish a clean-machine build.

Preflight also compares PRF01's advertised GOOSE dataset and revision with the local SCL and requires a recent clear GOOSE indication at the same revision in BRF01's log. It passed against the isolated revision 3 stack. On the running stack it detected the revision 2 publisher, while the local model specifies revision 3. This check reads the control block and recent subscriber log. Packet-level and independent conformance validation remain separate.
