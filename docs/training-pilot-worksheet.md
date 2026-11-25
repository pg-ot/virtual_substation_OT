# SS-01 F01 pilot worksheet

**Plant-MMS profile only.** Do not use the current and fault expectations
below for direct HTTP input. Use the
[direct-HTTP pilot guide](training-direct-http-pilot.md) for that profile.

Trainee: ____________________  Date: ____________________

Use the station HMI, SIMF01, PRF01, BRF01 and the remote control-centre views supplied by the instructor. The process model supplies simulated measurements. Record indication quality as well as value. Different displays poll at different times, so a small difference between changing measurements is expected.

Before each exercise, ask the instructor to reset the bay. Wait for the instructor to confirm the baseline. Record the approximate time and your observations in the table. Use the station HMI faceplate for station switching. Follow the instructor's instructions before applying a scenario.

| Observation | Time | Position and quality | Current and quality | Trip or operation failure | Source view |
| --- | --- | --- | --- | --- | --- |
| Baseline | | | | | |
| Exercise 1 | | | | | |
| Exercise 2 | | | | | |
| Exercise 3 | | | | | |
| Exercise 4 | | | | | |

## Exercise 1 — Station switching

Open 52-F01 from the station HMI faceplate. Observe the breaker indication and current after movement finishes. Reset the breaker latch as required by the faceplate, then close the breaker. Compare the final position and current with SIMF01, BRF01 and the remote views.

1. What indications confirmed that the breaker completed each operation?
2. What happened to feeder current when the breaker was open?
3. Did the remote indications eventually agree with the station view?

Answer: _______________________________________________________________

## Exercise 2 — Feeder overcurrent

From a confirmed closed baseline, the instructor applies the feeder fault. Watch the protection indication, breaker position and current. Compare the station HMI and remote control-centre views after the breaker settles. Identify the station-bus protocol used for the automatic trip.

1. Which device asserted the trip and which device reported breaker position?
2. What happened to the current after the breaker opened?
3. Which observations show a trip and which show completed physical movement in the simulation?

Answer: _______________________________________________________________

## Exercise 3 — Breaker fails to open

From a confirmed closed baseline, the instructor selects the stuck-breaker scenario and applies the feeder fault. Allow time for the operation-failure indication. Compare BRF01, the HMI and the available remote control-centre views.

1. What position and operation-failure indications did you observe?
2. Was feeder current interrupted?
3. How does the result differ from Exercise 2?

Answer: _______________________________________________________________

## Exercise 4 — IEC 104 communication loss

From a confirmed baseline, the instructor stops the IEC 104 gateway. Observe the position value and quality in the IEC 104 control-centre view, then compare the station view. The instructor restores the gateway and confirms the baseline.

1. How did the remote quality change after loss of the gateway?
2. Did the last displayed position alone prove the current state of the breaker?
3. What changed after the gateway reconnected?

Answer: _______________________________________________________________

## Review

Trace the feeder-fault sequence from the simulated measurement through PRF01, GOOSE, BRF01, the station HMI and one remote control centre. Identify the point at which a command or trip was issued and the separate point at which breaker position was confirmed.

Answer: _______________________________________________________________

Instructor review: ____________________  Follow-up: ____________________
