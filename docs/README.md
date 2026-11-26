# Documentation index

Full map of where information lives. See the [top-level README](../README.md) for getting the lab running.

Never put passwords, credentials or sensitive captures in these documents.
Document the evidence location and access procedure without publishing secrets.

## Architecture and as-built state

| Information needed | Where to find or record it |
|---|---|
| Current implemented devices, signal ownership, protocol paths, settings, point mappings, limitations and a dated deployment snapshot | [As-built reference](as-built.md). Update it when implementation or the documented deployment changes; distinguish source from a verified running image. |
| Station, bay, process and supervisory topology, alternatives and network boundaries | [Architecture](ss01-architecture.md). Label implemented, experimental and planned paths separately. |
| Engineered data model, GOOSE dataset/address/revision and runtime configuration | Versioned [feeder CID](../native/feeder.cid), Compose files and the as-built reference. Record changes to dataset order or revision and the matching publisher/subscriber configuration. |
| Protocol editions, roles, optional services, point maps and interoperability requirements | [Device profiles and release criteria](../specs/001-feeder/protocol-profiles.md), with implemented mappings in the [as-built reference](as-built.md). Record unsupported functions and do not treat target profiles as certification. |

## Running and operating it

| Information needed | Where to find or record it |
|---|---|
| Startup, ports, profile selection, operation, captures and safe isolation | [Container runbook](container-bench.md); native-only commands and settings are in [native build and operations](../native/README.md). Record the project, overlays and port overrides used. |

## Test evidence and acceptance

| Information needed | Where to find or record it |
|---|---|
| Test cases, results, captures, build identity, topology, dates, failures and limitations | [Scenario test cases](scenario-test-cases.md), [latest isolated run](../outputs/scenario-validation-20261123/report.md), [technical validation](f01-technical-validation.md) and dated [evidence reports](../outputs/iec61850-implementation-validation.md). Keep historical observations intact; add new evidence with its own scope and links. |
| Open IEC 61850 acceptance work | [Implementation checklist](iec61850-implementation-checklist.md) and [GOOSE run sheet](../specs/001-feeder/p1-linux-run.md). Mark a test complete only with evidence for the stated scope. |

## Training and instructor materials

| Information needed | Where to find or record it |
|---|---|
| Training scenarios and instructor instructions | [Direct-HTTP pilot guide](training-direct-http-pilot.md), [instructor guide](training-f01-instructor-guide.md) and [scenario guide](instructor-scenarios.md). Select the correct measurement profile; record prerequisites and expected feedback separately from commands. |
| Trainee practical worksheets for all four sessions | [Practical workbook PDF](../outputs/SS-01-practical-workbook.pdf) or [editable Word version](../outputs/SS-01-practical-workbook.docx). Instructors should rehearse the selected profiles and provide project-specific addresses. |
| Kali desktop activities for all four sessions | [Kali student practicals](container-bench.md#student-practicals-on-the-kali-desktop), including capture analysis and backup hash verification. Instructor operations remain separate. |
| Session flow, preflight, timings and answer guidance | [Four-session facilitator guide](training-facilitator.md). Perform the human trainee rehearsal and document sign-off before release. |
| Revised presentations aligned with the practicals | [Session 1: IEC 62443](../outputs/SS-01-Session-1-aligned.pptx) · [Session 2: protocol analysis](../outputs/SS-01-Session-2-aligned.pptx) · [Session 3: secure access](../outputs/SS-01-Session-3-aligned.pptx) · [Session 4: recovery](../outputs/SS-01-Session-4-aligned.pptx). Original presentations are unchanged. |
| Optional VPN and jump-host exercise, configuration, session controls and security boundaries | [Secure remote access training pilot](training-secure-remote-access.md). This local container-to-container demonstration is off by default and does not protect the existing direct lab interfaces. |
| IEC 104 configuration fault, hash-verified restore and RTO/RPO / 3-2-1 teaching | [Resilience and recovery exercise](training-resilience-recovery.md). Use a separate disposable project; control requires a separate authorized test, and historical data is not backed up. |

## Design history

| Information needed | Where to find or record it |
|---|---|
| Design rationale, proposed work and future acceptance | [ADRs](adr/README.md), [architecture plan](../specs/001-feeder/full-architecture-plan.md) and [low-level design](../specs/001-feeder/low-level-design.md). Treat proposals as targets, not as-built facts. |
| Feature tasks tracking pending browser connections, station configuration and independent interoperability | [Feature tasks](../specs/001-feeder/tasks.md) |
