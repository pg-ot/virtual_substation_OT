# SS-01 four-session facilitator guide

These are supervised exercises in a simulated substation, not operating
instructions for a real installation. Use a dedicated project and local
training host. A browser-led or automated check is not a human trainee
rehearsal, protocol conformance test or IEC 62443 certification.

## Preparation and preflight

1. Select the Compose project, image and measurement profile; record them
   with the station, capture overview, gateway and control-centre URLs in the
   workbook. Check that the selected project is not in use by another class.
2. Verify the gateway and control-centre pages and their actual link and
   point quality. HTTP reachability alone does not establish protocol health.
3. For the direct-HTTP profile, open one controlling station page, apply
   120 A and keep it running. The three-second input lease expires if the
   page stops renewing; reapply the value and recheck quality if it expires.
   Do not use competing controlling pages.
4. Confirm the plant fault is clear and the station and available remote
   views show CLOSED, normal current, trip CLEAR, close latch CLEAR and
   operation failure CLEAR, with GOOD quality. Use the
   [direct-HTTP pilot guide](training-direct-http-pilot.md) to recover a
   non-baseline simulation; never bypass an interlock.
5. Test capture downloads and Wireshark on the training host. Endpoint
   captures can overlap, start at different times and omit traffic; they are
   not a full network tap. Treat captures and logs as potentially sensitive.
6. Prepare the optional access route and a **separate disposable** recovery
   project only if those exercises will be run. Independently provide the
   trusted recovery fingerprint. Never expose the host capture agent as a
   remote multi-user service.

At class time repeat the baseline checks: old GOOD-looking values or a
previously healthy deployment do not establish the present state.

## Timetable and handoffs

These are suggested allocations, including practicals, not additional
time. Adjust after a human rehearsal.

| Session | Presentation | Practical | Debrief | Contingency | Total |
|---|---:|---:|---:|---:|---:|
| 1: IEC 62443 | 30 min | 25 min | 15 min | 5 min | 75 min |
| 2: protocol analysis | 20 min | 60 min | 15 min | 10 min | 105 min |
| 3: secure access | 20 min | 35 min | 15 min | 5 min | 75 min |
| 4: recovery | 20 min | 60 min | 15 min | 10 min | 105 min |

Use the common case: map the feeder, investigate a trip, assess a vendor
access request, and recover remote communications. The recovery fault is
an explicitly different, isolated configuration exercise, not evidence
that the trip caused a cyber incident.

## Discussion and answer guidance

### Session 1 — practicals 1A–1B

- PRF01 evaluates current and sends trip and quality to BRF01 over GOOSE.
  BRF01 derives position from simulated contacts; the HMI and gateways
  read position and protection data via MMS. The IEC 104 gateway maps
  information to the remote master.
- A proposed zone needs assets, owner and risk rationale; a conduit needs
  endpoints, purpose and a testable allow/deny requirement. Docker network
  names are discussion inputs, not evidence of an engineered security zone.
- An approval, individual identity, expiry and session audit may be good
  requirements, but are not automatically enforced by the access pilot.

### Session 2 — practicals 2A–2G

- For a same-event capture in a **disposable direct-HTTP project**, establish
  the preflight baseline and default 200 A pickup. On the capture-enabled
  overview choose **All lab networks** and 60 seconds; wait until it reports
  running. On the controlling station page apply and hold 250 A, wait for
  trip ASSERTED and contact-derived OPEN/GOOD, and keep the page renewing
  the input. While 250 A is held, the instructor runs the overview's
  displayed `docker exec <station-hmi-container-id> station-client read`
  command on the Docker host. Apply 120 A, stop the capture and complete
  the separate instructor reset. The automatic sequence returns to 120 A
  after three seconds and is not suitable for this held-current read. Do
  not restart a captured container to create an association.
- Inspect the individual station-HMI station-interface capture for MMS,
  breaker station-interface capture for GOOSE, and control-centre
  supervisory-interface capture for IEC 104. Check the manifest for
  interface coverage, time intervals, errors and drops. Ask for the
  instructor's help if capture startup is delayed or an input lease expires.
- A worked [same-event capture](../outputs/captures/3c16e5522cd1d32e/manifest.json)
  contains MMS OPEN, asserted trip and 250 A request/response pairs at
  frames 155/156, 168/169 and 171/172 of
  [`13-station-hmi-station-eth0.pcap`](../outputs/captures/3c16e5522cd1d32e/13-station-hmi-station-eth0.pcap);
  GOOSE asserted trip at frame 149 of
  [`10-breaker-station-eth2.pcap`](../outputs/captures/3c16e5522cd1d32e/10-breaker-station-eth2.pcap);
  and IEC 104 trip, 250 A and OPEN at frames 2, 4 and 9 of
  [`14-control-centre-supervisory-eth0.pcap`](../outputs/captures/3c16e5522cd1d32e/14-control-centre-supervisory-eth0.pcap).
  These are historical examples, not today's event or a full network tap.
- The direct browser-to-PRF01 current input is HTTP, not MMS or SV, and
  remains at the injected value when the breaker opens. Plant-MMS and SV
  are different profiles.
- PRF01's configured GOOSE dataset contains trip and quality, not current
  or BRF01 position. APPID is `0x1000`, destination is
  `01:0C:CD:01:00:01`, and ConfRev is 3. A state change is distinguished
  from retransmission by `stNum` and `sqNum`; inspect the configured data
  and quality before deciding what a frame means.
- MMS reads are request/response exchanges. Associate the request and
  response on the same connection, identify the model item and record
  uncertainty if the association or value is not decodable.
- IEC 104 common address 1 identifies this configured station; IOAs 100,
  101 and 102 respectively represent position, trip and phase-A current.
  Type and cause describe the information and why it was sent. Contact
  feedback and trip are different facts.
- The simulated IEC 104 command uses double command type 46, CA 1, IOA 100
  and select/execute. Compare activation and termination responses with
  independently read BRF01 position and quality. Do not retry an uncertain
  operation or bypass a latch or protection permissive.
- The isolated
  [control example](../outputs/captures/iec104-control-review-20261123-1248/control-centre.pcap)
  contains a select/execute exchange at frames 237–242, a termination at
  frame 275, and a negative termination at frame 401 for a separately
  interlocked close. These frame numbers apply only to that file; they do
  not establish independent interoperability or production authorization.
- Historical examples from the 23 November review:
  [`12-protection-station-eth0.pcap`](../outputs/captures/2df42b3e7b3179a7/12-protection-station-eth0.pcap)
  frames 489 and 595 contain clear and asserted GOOSE values;
  [`14-control-centre-supervisory-eth1.pcap`](../outputs/captures/2df42b3e7b3179a7/14-control-centre-supervisory-eth1.pcap)
  includes IEC 104 points. The separate fresh-association
  [`03-protection-station-eth0.pcap`](../outputs/captures/c8c6ed01fd014927/03-protection-station-eth0.pcap)
  has MMS requests/responses at frames 264–267. The second capture was
  recorded after the event and its gateway interface failed when that
  container was restarted; it does not prove a single continuous event
  chain. Some endpoint frames are duplicated. Do not mix frame numbers
  from different files or present historical evidence as today's event.
- In Wireshark, open the relevant individual endpoint file and use `goose`,
  `mms` or `iec60870_asdu` as a display filter. For MMS, use **Analyze →
  Decode As** to decode the relevant TCP port (8102, 8103 or 8104) as
  TPKT, and capture the association from its beginning. Compare the request
  and response in that TCP conversation; a generic response does not itself
  name the requested point. If packets or decoding are missing, record
  unknown rather than copying the expected answer.

### Session 3 — practicals 3A–3C

The optional demonstration is a local container-to-container WireGuard
tunnel and SSH jump host to the gateway web page. The host browser and the
final jump-to-gateway connection use HTTP; direct local lab pages remain
available. A past VPN handshake is not evidence that the SSH forward remains
active. Disconnecting SSH does not revoke keys or stop WireGuard. MFA,
per-person approval, automatic expiry, session recording and centralized
audit are not implemented. See the [access guide](training-secure-remote-access.md).

### Session 4 — practicals 4A–4E

The tabletop's broader outage is a teaching scenario. The practical changes
only the isolated IEC 104 master's configured port, verifies the backup
bytes against an independently supplied trusted hash, restores the file,
restarts the master and checks fresh monitoring. Hash equality is not proof
that the trusted reference or system is clean. Control and protection
require separate authorized tests; supply cannot be inferred solely from
communications.

RTO is the target for an agreed service and measured interruption runs to
acceptance, not necessarily the first indication. RPO is a recovery-point
age target; the exercise restores a static configuration, not historical
SCADA data. A backup and working copy in one host directory do not implement
3-2-1. See the [recovery guide](training-resilience-recovery.md).

## Before release

Rehearse each selected exercise on the intended host and record image,
profile, evidence, timings and failures. A human trainee should then follow
the materials with minimal prompting; record confusion and completion time
and resolve issues before sign-off. Do not treat automated checks as that
human acceptance.
