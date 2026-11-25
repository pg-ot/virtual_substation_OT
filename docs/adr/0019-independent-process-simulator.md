# ADR 0019 — Separate breaker mechanism and feeder state from the bay IEDs

**Status:** Accepted for the P2 bench. Live acceptance stays open.

## Context

P1 BRF01 bench feedback changed immediately when a trip was received. PRF01 supplied an injected phase current that could stay at 1,200 A after breaker opening. The operator needs independent evidence of movement and interruption.

## Decision

Enable the independent process fixture with `LAB_DISTRIBUTED=1` and `LAB_PROCESS_MODEL=1`. SIMF01 owns the breaker mechanism, electrical continuity, fault stimulus and the two auxiliary contacts. A read of `SIMF01LD0/LLN0.ProcessState` returns the contact pair, fault status, source voltage, feeder current and the contact timestamp together. BRF01 requests movement through the local training actuator `SIMF01LD0/GGIO1.SPCSO1`. Actuator acceptance starts a movement deadline. Confirmation comes from the contacts. An open request can supersede closing at the actuator.

| Contacts | BRF01 position |
|---|---|
| 52a on, 52b off | CLOSED |
| 52a off, 52b on | OPEN |
| Both off during an active movement | INTERMEDIATE until the deadline |
| Both on, feedback lost, or intermediate after timeout | UNKNOWN with invalid quality |

BRF01 exposes operation failure as `BRF01LD0/GGIO1.Ind1`. A failed open with unchanged closed contacts keeps confirmed CLOSED. Loss of process feedback inhibits closing and invalidates position or current independently. An accepted request with an uncertain outcome is left for local resolution. Repeated indications within one sustained trip are suppressed.

PRF01 reads synthetic feeder current and latches its trip when the active fixture fault produces elevated current. SIMF01 holds the source at 11 kV and sets feeder current by electrical continuity. Breaker opening reduces current to zero. Fault clearance is a separate plant action. The development current levels remain 120 A normal and 1,200 A faulted to match the earlier bench exercise.

## Alternatives and consequences

Keeping the plant inside BRF01 would simplify deployment and make independent mechanism failures harder to exercise. The chosen loopback MMS adapter lets the Windows bench run the native IEDs as separate processes. The target process bus, engineered SCL, waveform generation and independent live GOOSE and SV evidence remain follow-on work. See the [process smoke test](../../native/process-smoke.mjs).
