# ADR 0028 — Sampled Values training profile

## Context

The feeder protection IED needs a process-bus input derived from the simulated feeder current. The existing process model publishes RMS measurements over MMS. Its breaker contacts and scenario state remain available through that interface.

## Decision

MUF01 reads the process model and generates balanced 50 Hz three-phase instantaneous current and voltage samples. The experimental Layer 2 stream uses libiec61850, APPID `0x4000`, multicast destination `01:0c:cd:04:00:01` and an eight-channel data set. Each channel carries a signed 32-bit value and quality. Current uses 1000 counts per primary ampere and voltage uses 100 counts per primary volt. The voltage channels use line-to-neutral values derived from the simulated line-to-line voltage. The neutral and residual channels are zero for this balanced model.

The experimental Compose SV profile defaults to **400 samples per second**
(eight per 50 Hz cycle) using stream ID `MUF01/LLN0$Msv08`, revision 1,
`smpRate=8` and a sample counter wrapping from 399 to 0. This deliberately
coarse profile is for isolated training experiments only; it is not claimed
to conform to IEC 61869-9 or 9-2LE or to represent real protection fidelity.
Set `LAB_SV_SAMPLES_PER_SECOND=4000` for the earlier 80-sample-per-cycle
profile with stream ID `MUF01/LLN0$Msv01`, `smpRate=80` and counter wrap at
3999. Both the publisher and protection IED must use the same setting. The
standalone native binaries default to 4,000 samples per second and reject
unsupported settings at startup. Compose treats an unset or empty setting as
the 400-sample default.

PRF01 calculates RMS current from a continuous cycle of received phase-A samples. It invalidates the input on sample discontinuity or timeout and does not silently switch to the MMS measurement when SV is selected. The model asserts overcurrent at 200 A and latches the trip. Its GOOSE trip path remains enabled.

The current source retains a gap, invalid sample, or timeout detected between
process reads until the next receiver read reports invalid, even if a fresh
cycle has already arrived. It still requires a continuous one-cycle window
before reporting a valid value. This visibility change is not yet deployed to
the ordinary live stack and does not eliminate sample loss or guarantee prompt
fault detection.

The current source also samples the receiver on a separate approximately
5 ms worker instead of waiting for each 50 ms plant MMS read. The most recent
plant read must still have succeeded, and a failed read invalidates the
current. The publisher moves diagnostic formatting and output to a separate
thread so it is not done directly by the sample scheduling loop. These
source-only changes do not eliminate skips, provide hard scheduling bounds,
or make the experimental profile suitable for the live training path.

The experimental Docker profile uses untagged frames on the process bridge. The Linux library's SV socket binds to the SV EtherType, which requires separate validation for 802.1Q-tagged traffic on the virtual Ethernet path. The optional `smpMod` field is omitted because the pinned library publisher encodes it with a length rejected by its own subscriber. Sampling mode is defined by this profile. SV and GOOSE remain separate Layer 2 flows.

The experimental `compose.sv.yaml` profile temporarily defaults to four consecutive ASDUs per frame. At 400 samples per second this gives a nominal 100 frames per second and adds up to approximately 10 ms of sample accumulation delay; at 4,000 samples per second the corresponding figures are 1,000 frames per second and approximately 1 ms. Set `LAB_SV_ASDUS_PER_FRAME=1` for one ASDU per frame; the native publisher's standalone default remains one. Grouping changes the stream configuration and does not guarantee continuity. An optional Linux `LAB_SV_REALTIME_PRIORITY` enables SCHED_FIFO when the container has the required capability. It defaults to zero and is not enabled by the Compose profile. Both settings are experimental. The publisher advances its sample counter past missed deadlines, allowing the receiver to detect discontinuities.

For a capture from the 400-sample, four-ASDU profile, run
`node containers/sv-capture-analysis.mjs <capture.pcap> 4 8`. The final
argument selects the eight-sample cycle and 400-count wrap. Omit it for
the earlier 80-sample profile.

## Consequences

This is an experimental training profile. The source is an MMS-polled RMS process model, not a digitized sensor waveform. It is unsynchronized and sets `smpSynch` to zero. Host scheduling and packet loss affect validity, and the publisher does not set the SV frame simulation flag. The capture, sample continuity, loss behavior, trip and recovery must pass end-to-end checks before this profile is used for training. SCL engineering, clock synchronization, VLAN and priority handling, measurement accuracy, timing, simulation indication and independent interoperability remain open. This decision makes no conformance or industrial performance claim.

On 22 November 2026 the requested target changed: SV is to become the required
training measurement path. It is not yet accepted or enabled in the ordinary
live deployment. Observed publisher skips, the unsynchronized synthetic
source, host scheduling and the remaining plant-read dependency remain bottlenecks;
the complete path needs improvement and acceptance before changing the live
measurement source.

Short experiments using grouping, SCHED_FIFO and CPU affinity still showed sample discontinuities. SCHED_FIFO with one ASDU also consumed substantially more CPU in the observed run. These controls must not be treated as a timing guarantee. Results and capture locations are in the [validation report](../../outputs/sv-validation-report.md).

On 23 November 2026 the requested simulation input changed to an optional
direct HTTP browser-to-PRF01 process-current exercise, enabled by
`compose.http-input.yaml`. This mode is mutually exclusive with SV, sends
phase-A RMS current directly to the PRF01 component endpoint, and expires
the input after three seconds without an update. It is a local simulation
interface, not an IEC 61850 process-bus protocol. The SV publisher/receiver
remain available only as a separate experimental profile; their prior gap
and quality acceptance blockers remain unchanged. BRF01 continues to
subscribe to PRF01 GOOSE trips; its contact-confirmed position is returned
to the station and gateways over MMS and then mapped to IEC 104 and optional
DNP3.
