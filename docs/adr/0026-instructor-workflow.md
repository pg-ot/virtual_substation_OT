# ADR 0026 — Instructor scenario workflow

## Decision

Run the instructor console as a loopback-bound host process. It starts the instructor command workflow, which sends scenario inputs to SIMF01 through its existing console and uses station control for breaker recovery. A single active browser action is permitted at a time. Action results are appended to a project-tagged local history file. Existing component browser pages communicate only with their own services.

The reset workflow restores the IEC 104 gateway, clears fault and mechanism conditions, resets protection, reconciles breaker state and verifies baseline indications at each running gateway and control centre. It reports a failure when the required state cannot be verified.

## Consequences

The instructor host requires Docker CLI access and Node.js. The loopback console and its action history are local to that host. Stopping the IEC 104 gateway supports one supervisory communications-loss exercise. Additional failure modes and a multi-user training deployment require further design and acceptance testing.
