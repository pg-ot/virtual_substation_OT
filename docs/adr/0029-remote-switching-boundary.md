# ADR 0029 — Remote switching boundary

## Status

The IEC 104 command path is enabled for supervised simulated training.
DNP3 remote switching is not implemented. The broader design and acceptance
items below remain open: enabling training control is not production
authorization, independent interoperability or protocol conformance.

## Context

The station HMI calls the native MMS client to operate `BRF01LD0/XCBR1.Pos` and separately checks fresh breaker position feedback. BRF01 owns the local operating checks, including breaker position, a fresh protection permissive, trip latch and in-progress movement. The HMI distinguishes command acceptance from confirmed position. An MMS command accepted by BRF01 can still fail to produce the requested position.

The IEC 104 gateway publishes monitored points and supports interrogation.
The control-centre interface can issue simulated selected breaker commands.
The DNP3 outstation uses a command handler that reports commands unsupported.
Both gateways have their own connections and may receive competing requests
while station control or a protection trip is active.

## Decision

Implement each protocol's command endpoint inside its own gateway and use an MMS client connection to BRF01 for execution. The gateway must not command SIMF01 directly or send a request through the station HMI web interface. BRF01 remains authoritative for switching interlocks and automatic GOOSE protection remains independent of gateway availability.

Engineer explicit command objects, point addresses, supported control operations and transaction behavior for each protocol. Preserve the distinction among a request, protocol acceptance, MMS acceptance and confirmed breaker feedback. A successful protocol response must describe only the stage actually completed. Use good-quality, post-request BRF01 position feedback to confirm a transition, and report unconfirmed or failed operation when feedback is unavailable or the operation times out. Do not retry or replay an execution after an uncertain outcome.

Selections must be associated with the requesting connection and command value, expire, be consumed on execution, and be cleared on disconnect. Recheck the command and device state at execution. An operation already in progress, a conflicting selection, unavailable or invalid feedback, and BRF01 rejection require a negative response. A protection trip may supersede a remote request. Changes in local or remote authority, settings, and any latch reset require explicit engineering and separate validation rather than an automatic reset during close.

Protocol callbacks must remain responsive during MMS calls and movement confirmation. Bound in-flight work and preserve per-connection response ownership. If a connection closes after execution is dispatched, complete local tracking without sending a result to a replacement connection or replaying the command. Cross-gateway and station contention must be resolved at BRF01 as well as represented accurately by the requesting gateway.

## Acceptance

Exercise each protocol against an independent master and a project master. Capture the command exchange and breaker feedback. Cover open, close, selection expiry, execute without selection, wrong value or address, duplicate execute, disconnect during selection and after dispatch, unavailable MMS, invalid or stale position, stuck breaker, concurrent local and remote commands, concurrent gateways, protection trip during operation, and restart without replay. Verify response causes and command lifecycle against the selected protocol edition and documented device profile. Include negative tests and source-timestamp evidence. A project peer or packet decode alone does not establish conformance.

The IEC 104 and DNP3 profiles, command addresses, authorization model, timeout values, and independent conformance evidence remain to be specified and validated before this capability is considered complete.

## Current IEC 104 baseline

The initial monitoring-only gateway returned a negative unknown-type response to a selected double command. The experimental handler now accepts double commands at common address 1 and information object address 100 with qualifier 0 and a five-second selection interval. An isolated test with Layer 2 GOOSE enabled verified rejection of execute without selection, selected open and close with source-timestamped position confirmation, and a negative termination for close while the protection trip was asserted. The bay was reset afterward. `iec104-command-probe` is an excluded-from-default-build native test target, uses the same library family as the gateway and is not an independent conformance test.

The initial test exposed two defects that were corrected before the successful rerun. The lib60870 termination helper cleared the negative flag, and the shared MMS client attempted to reconnect an already connected breaker session. The handler now sends the termination ASDU with its negative flag preserved, and the MMS client reuses an established connection. A positive activation confirmation indicates gateway dispatch. The subsequent termination reports whether the requested position was observed. Further lifecycle, contention, network failure, authorization, response-cause and independent-master tests in the acceptance section remain open. No standards-conformance claim is made for this experimental implementation.

Additional isolated probe runs confirmed that execute without selection, an execute value differing from its selection, and an execute after the configured five-second selection expired each received a negative activation confirmation. Breaker position remained CLOSED with good quality. These cases use the project probe and do not cover conflicting connections, disconnect timing or command replay after a restart.

A subsequent two-connection probe selected a command on the first connection, observed rejection of a competing selection on the second, closed the first connection, and then selected successfully on the second. The breaker remained CLOSED with good-quality feedback. This covers selection cleanup after an orderly disconnect. Disconnect during dispatched execution, simultaneous gateway and station operations, abrupt network loss and restart replay remain open. The handler also rejects incoming command ASDUs with their negative flag set.

Another isolated run disconnected the requesting master after the gateway's positive execute confirmation. BRF01 reported OPEN with good quality, and SIMF01 logged one accepted open operation. Restarting the gateway left the breaker OPEN and did not add a second accepted open operation. The instructor reset then restored the verified baseline. This covers one orderly client-disconnect and gateway-restart sequence. It does not cover abrupt network failure, gateway termination during an in-flight operation, all timing races or independent interoperability.

The experimental handler was updated to return negative unknown-cause, unknown-common-address and unknown-information-address responses for those respective command errors. An isolated project probe observed causes 45, 46 and 47 respectively. An open then succeeded but an immediate close received a negative termination before the instructor baseline reset; the reset reported a latch reset. After that reset, selected open and close both completed with confirmed position. These observations are consistent with the BRF01 latch interlock and show why a prepared baseline matters. They do not establish comprehensive IEC 104 response-cause conformance.

The first isolated control-centre test used an experimental open and close
panel enabled by `LAB_IEC104_CONTROL_UI=1` and a gateway enabled by
`LAB_IEC104_CONTROL=1`. Its backend starts a local IEC 104 master command,
which uses select and execute with the gateway. In that deployment the page
rendered, a foreign-origin command request was rejected with HTTP 403,
normal open and close returned position confirmed, and a close under
asserted protection trip returned HTTP 409 with `REJECTED OR NOT CONFIRMED`
while the breaker remained OPEN. The baseline was restored. These are
historical results for the opt-in configuration; authority, further protocol
error cases and independent-master testing remain open.

An isolated browser follow-up exercised close, open and close through the control-centre buttons after the instructor latch reset. Each returned position confirmed and BRF01 reported the requested position. IEC 104 maps BRF01 close-inhibit latch `GGIO1.Ind2` to single point CA 1 / IOA 104. The gateway polls its value, quality and source time, includes it in interrogation and sends timed spontaneous indications on change. An isolated test observed the startup latch asserted at the station, gateway and control centre, matching source timestamps, and then clear after a station latch reset. The component acceptance observed the latch assert after an automatic trip. Stopping the gateway made the remote latch quality stale, and restarting it restored a good indication. These checks used project peers and the rebuilt isolated image. Independent interoperability and full lifecycle tests remain open. A latch indication is one input to the operator's assessment and does not identify every possible reason for command rejection.

DNP3 maps the latch to binary input 2, with a Class 1 event and timed Group 2 variation 2. In an isolated run the component acceptance passed automatic and failed trips, including an asserted latch with good quality and a source timestamp at the DNP3 master. Station, gateway and master timestamps matched for the asserted event and for the subsequent cleared latch after instructor reset. Stopping the DNP3 gateway made the master's latch quality stale. After the gateway restarted, the master again reported the clear latch with good quality. These tests used the project master and do not establish independent interoperability or conformance. The running training deployment has not yet been updated with these changes.

With experimental IEC 104 control enabled in an isolated stack, a remote close during a protection outage and after expiry of the clear GOOSE permissive returned `REJECTED OR NOT CONFIRMED`, and BRF01 remained OPEN. After PRF01 restarted, a remote close returned `POSITION CONFIRMED` and the station HMI reported CLOSED. The optional `LAB_TEST_IEC104_CONTROL=1` branch of the recovery smoke test repeats this sequence. It requires both IEC 104 control settings to be enabled and changes the selected stack's state.

## DNP3 selection lifecycle investigation

The pinned opendnp3 3.1.2 command handler returns its command status synchronously. Its documented `SUCCESS` status means accepted, initiated or queued, so downstream MMS acceptance and confirmed breaker position require separate tracking. The handler callback must remain responsive while that downstream work proceeds. The [upstream outstation guide](https://github.com/dnp3/opendnp3-guide/blob/master/docs/api/outstations.md) describes these callback semantics.

Inspection of the pinned library found that `OContext::OnLowerLayerDown` does not explicitly clear `ControlState`, and the successful `HandleOperate` branch does not explicitly call `Unselect`. The excluded-from-default-build `dnp3-selection-probe` target demonstrates that the internal selection validator can accept the same matching sequence and command twice until `Unselect` is called. This is a focused internal-state result. It does not by itself establish that a second network operation is accepted, because the protocol stack also handles request history, sequence numbers and timeouts. A live reconnect and duplicate-operate test is required before defining the control boundary or enabling DNP3 switching. The running outstation continues to reject DNP3 commands as unsupported.
