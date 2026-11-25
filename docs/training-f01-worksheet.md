# SS-01 F01 trainee worksheet

The instructor will provide the station HMI, SIMF01, PRF01, BRF01 and control-centre URLs. The instructor controls simulated scenarios and will confirm the starting state before each exercise.

## 1. Normal bay

1. Record breaker position, feeder current, protection trip and point quality from the station HMI.
2. Compare the HMI breaker position with BRF01 and the feeder current with PRF01.
3. Compare the control-centre indications with the station indications.

Record the source of each point and any differences in its timestamp or quality.

## 2. Station switching

1. Open the 52-F01 faceplate, select **Open** and confirm the operation.
2. Observe the breaker position and feeder current as the mechanism moves.
3. Restore CLOSED using the faceplate controls and record the command result and feedback.

Explain what evidence confirms breaker movement and what the current does when the breaker is open.

## 3. Feeder fault

The instructor applies a fault from a CLOSED baseline.

1. Observe PRF01 trip, BRF01 position and the station HMI.
2. Compare the control-centre position and current with the station indications.
3. In the provided packet capture, locate a GOOSE trip assertion and a retransmission. Record the control block, APPID, state number and sequence numbers.

Explain the relationship between the protection trip and contact-confirmed breaker position.

## 4. Failed breaker opening

The instructor enables a stuck mechanism and applies a fault.

1. Record the trip, breaker position, operation-failure alarm and current.
2. Compare the alarm at BRF01, the HMI and the control centre.
3. Explain how this differs from the successful trip exercise.

## 5. Lost IEC 104 gateway

The instructor stops the IEC 104 gateway.

1. Record the control-centre point quality and compare it with the station HMI.
2. Observe what happens when the instructor restores the gateway.
3. Explain which indications represent last-known data and how recovery is shown.

After each exercise, wait for the instructor to confirm baseline reset.
