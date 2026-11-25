#!/usr/bin/env bash
set -o pipefail

if [[ -t 0 ]]; then
  trap 'printf "\nPress Enter to close... "; read -r _' EXIT
fi

capture() {
  local filter=$1 label=$2 file type count reply
  shift 2
  printf '\nEnter the path to the instructor-supplied %s capture (for example /captures/example.pcap):\n> ' "$label"
  IFS= read -r file || { echo "No capture path provided." >&2; return 1; }
  if [[ ! -f "$file" || ! -r "$file" ]]; then
    printf 'Cannot read capture: %s\n' "$file" >&2
    return 1
  fi
  if ! type=$(capinfos -T -t -r -- "$file"); then
    echo "Cannot read capture format. Ask the instructor for a valid PCAP or PCAPNG file." >&2
    return 1
  fi
  type=${type##*$'\t'}
  if [[ $type != pcap && $type != pcapng ]]; then
    printf 'Unsupported capture format: %s. Use PCAP or PCAPNG.\n' "$type" >&2
    return 1
  fi
  if ! count=$(tshark -r "$file" "$@" -Y "$filter" -T fields -e frame.number | awk 'END {print NR+0}'); then
    echo "Capture could not be decoded. Check the file and ask the instructor." >&2
    return 1
  fi
  printf '\nMatching %s frames: %s\n' "$label" "$count"
  if [[ $count == 0 ]]; then
    echo "No matching decoded frames: check the capture point, timing and decoding; absence here does not prove no traffic."
  fi
  printf 'Open this capture in Wireshark with filter %s? [y/N] ' "$filter"
  IFS= read -r reply || return 1
  if [[ $reply == [yY] || $reply == [yY][eE][sS] ]]; then
    if ! wireshark -r "$file" "$@" -Y "$filter"; then
      echo "Wireshark could not open the capture." >&2
      return 1
    fi
  fi
}

verify_hash() {
  local file expected actual
  printf 'Path to instructor-supplied backup (for example /captures/approved-backup.json):\n> '
  IFS= read -r file || return 1
  if [[ ! -f "$file" || ! -r "$file" ]]; then
    printf 'Cannot read backup: %s\n' "$file" >&2
    return 1
  fi
  printf 'Enter the 64-character SHA-256 from the independent trusted channel:\n> '
  IFS= read -r expected || return 1
  if [[ ! $expected =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "Invalid SHA-256 fingerprint. Stop; obtain the complete trusted fingerprint." >&2
    return 1
  fi
  actual=$(sha256sum < "$file") || { echo "Hash calculation failed." >&2; return 1; }
  actual=${actual:0:64}
  printf 'Calculated: %s\nExpected:   %s\n' "$actual" "${expected,,}"
  if [[ $actual != "${expected,,}" ]]; then
    echo "MISMATCH: do not restore. Obtain a trusted copy and investigate." >&2
    return 1
  fi
  echo "MATCH: bytes match the supplied fingerprint. This does not prove provenance, suitability or a clean system."
  echo "Record both fingerprints and their sources. The instructor must re-verify and authorize any host-side restore."
}

echo "SS-01 practical ${1:-}"
echo "Use the workbook to record your observations. Work only on instructor-authorized simulations."
case "${1:-}" in
  1A)
    cat <<'EOF'
Map the substation
1. On the instructor's host, open the supplied lab overview. Identify SIMF01, PRF01, BRF01, station HMI, gateway and remote control centre.
2. Trace the measurement, trip, contact-derived position and supervisory paths. Record each asset, peer, protocol and evidence in workbook 1A.
3. Assign the asset owner, system integrator, product supplier and service provider. Who approves support, and who performs it?
A web page being reachable does not prove protocol health or breaker operation.
EOF
    ;;
  1B)
    cat <<'EOF'
Zones, conduits and evidence
1. Group the assets by risk and access need; draw proposed zones.
2. For each crossing, record sender, receiver, allowed service, purpose and risk.
3. Write one testable remote-access requirement: named identity, target, action, conditions and expiry.
4. Describe an allowed test, a denied test, evidence and its owner in workbook 1B.
Docker network names alone do not prove an IEC 62443 assessment or enforced policy.
EOF
    ;;
  2A)
    cat <<'EOF'
Predict the signal journey
1. With the instructor identify PRF01 current/trip, BRF01 position, station HMI and IEC 104 remote view.
2. Sketch the paths and protocols for current, trip and independent contact-derived position.
3. Record baseline values and quality. Ask the instructor to confirm the pickup setting.
4. Predict what happens to the trip latch after current drops below pickup.
The direct browser-to-PRF01 current input is HTTP, not MMS or Sampled Values. There is no reverse position GOOSE.
EOF
    ;;
  2B)
    cat <<'EOF'
Capture and observe - instructor operates the simulation
1. Instructor confirms CLOSED/GOOD and holds 120 A on the single controlling station page.
2. Instructor starts All lab networks capture and waits until it is running. Record scope and time.
3. Instructor holds 250 A, observes ASSERTED trip and OPEN/GOOD position, and runs the overview's read-only MMS command while capture is running. Return to 120 A and keep the station page open.
4. Record current, trip, position and quality at each stage. Instructor saves the manifest and individual station/supervisory files, then resets protection and breaker latch, closes and verifies baseline.
5. Ask the instructor to copy the files to /captures for 2C-2E. Record capture point and fresh-association availability.
This script does not inject a fault or start a capture. Endpoint captures can miss traffic; merged captures may contain duplicates.
EOF
    ;;
  2C)
    cat <<'EOF'
Inspect GOOSE: use a PRF01 or BRF01 station-side capture.
In workbook 2C compare clear and trip frames: frame/time, destination MAC, APPID, control block, dataset, ConfRev, TTL, stNum, sqNum and values/quality.
Identify publisher and subscriber; compare a new state with a retransmission. The dataset carries trip/quality, not current or reverse breaker position.
An asserted trip packet does not prove the breaker opened.
EOF
    capture goose GOOSE
    ;;
  2D)
    cat <<'EOF'
Inspect MMS and breaker feedback: use a station-interface capture with a fresh association.
In workbook 2D pair read requests and responses by association and identifiers. Record frame, reference/functional constraint, value and quality when actually decoded.
Compare PRF01 current/trip with separate BRF01 contact-derived position. Missing or undecodable evidence is unknown.
This helper decodes lab TCP ports 8102-8104 as TPKT; it cannot reconstruct a missing association.
EOF
    capture mms MMS -d tcp.port==8102,tpkt -d tcp.port==8103,tpkt -d tcp.port==8104,tpkt
    ;;
  2E)
    cat <<'EOF'
Follow IEC 104 points: use a supervisory-side capture.
For each signal record frame/time, ASDU type/cause, common address, IOA, value and quality in workbook 2E. Explain CA, IOA, type and cause.
Lab mapping: CA 1; IOA 100 position, 101 trip, 102 current, 103 failure, 104 close latch. Check the actual capture rather than assuming a value.
EOF
    capture iec60870_asdu "IEC 104 ASDU"
    ;;
  2F)
    cat <<'EOF'
Build the evidence chain
1. Join PRF01 current via MMS and IEC 104, trip via GOOSE and IEC 104, and contact-derived position via MMS and IEC 104.
2. For each row record capture/interface, frame/time, protocol identifier, observed value and quality.
3. Mark unknown when coverage, decoding, polling or timing cannot establish a fact. Do not mix a historical capture into a live event without labeling it.
4. State what is established and what is an assumption. Record who verified baseline restoration.
EOF
    ;;
  2G)
    cat <<'EOF'
IEC 104 control and feedback - supervised simulation only
1. Instructor selects the isolated project, confirms CLOSED/GOOD, trip and close-latch quality/permissives, and authorizes the operation.
2. Instructor starts supervisory capture and requests Open on the control-centre page. Record select/execute and response plus independently observed station and master OPEN/GOOD contact feedback.
3. Instructor checks permissives, separately resets the latch if required and authorizes Close. Record command/response and independent CLOSED/GOOD feedback.
4. Stop capture, inspect type 46 select/execute, CA 1 and IOA 100 as available. Mark missing evidence unknown; instructor restores and verifies baseline.
Stop on rejection, stale/invalid data or unconfirmed outcome; do not retry an uncertain operation. This launcher never operates the breaker.
EOF
    printf 'Inspect an instructor-supplied control capture now? [y/N] '
    IFS= read -r reply || exit 1
    if [[ $reply == [yY] || $reply == [yY][eE][sS] ]]; then capture iec60870_asdu "IEC 104 ASDU"; fi
    ;;
  3A)
    cat <<'EOF'
Decide whether to grant access
1. Assign asset owner, operator, vendor engineer and approver for a gateway support request.
2. Record named requester, ticket, target, task, prohibited actions, start/expiry, monitor, stop authority and approval conditions.
3. The vendor now asks to change configuration: what extra approval and evidence are needed?
These are tabletop decisions; the lab does not enforce per-person approval or expiry.
EOF
    ;;
  3B)
    cat <<'EOF'
Observe the optional secure path - instructor demonstration
1. On the host, observe the instructor-supplied forwarded gateway URL before connection; compare the ordinary direct URL.
2. Instructor connects: host browser -> simulated client container -> WireGuard -> SSH jump -> gateway web page. Record forwarded URL/outcome.
3. Observe accessctl status, jump logs and optional WireGuard UDP capture. Record SSH state, handshake and evidence; never record keys.
4. Instructor disconnects SSH; recheck forward and status. A previous handshake does not prove an active SSH session.
Kali is not the VPN client. Both endpoints are containers on one host. Direct host-loopback pages remain available.
EOF
    ;;
  3C)
    cat <<'EOF'
Confidentiality, integrity and access closeout
1. For CIA, record what the demonstration actually showed and what remains unproven.
2. Identify unencrypted HTTP hops: host browser to local client and jump host to gateway.
3. Does disconnect revoke the keys or stop WireGuard? What logging, approval, expiry and revocation are missing?
4. Propose an independent MFA factor. Two keys stored on the same machine do not demonstrate MFA.
EOF
    ;;
  4A)
    cat <<'EOF'
Outage impact - instructor uses a separate disposable recovery project
1. Record baseline and trusted snapshot time. Observe the instructor's authorized IEC 104 master configuration disruption.
2. Compare master link and fresh remote values/quality with station and gateway; record what is lost, observable and unknown.
3. Assess visibility, control, protection and simulated supply separately. Identify the recovery approver.
Loss of monitoring does not alone establish the status of protection or supply.
EOF
    ;;
  4B)
    cat <<'EOF'
Verify backup integrity
Obtain the backup in /captures and the expected SHA-256 via an independent trusted channel.
Compare the entire digest before restoration. A mismatch stops recovery.
EOF
    verify_hash
    ;;
  4C)
    cat <<'EOF'
Restore and validate - instructor performs host-side actions
1. After 4B, obtain authorization. Instructor re-verifies the trusted hash and restores using the recovery guide in the dedicated disposable project.
2. Instructor restarts only that project's control-centre. Stop if verification, restoration or restart fails.
3. Verify TRANSFERRING and fresh GOOD position, trip and current against station and gateway. Record first restored indication and later acceptance separately.
4. Control and protection require separate authorized tests; if not tested, mark unverified. Do not treat a web page alone as acceptance.
Kali has no Docker socket or access to the host recovery directory. This launcher does not restore or restart anything.
EOF
    ;;
  4D)
    cat <<'EOF'
RTO and RPO
1. Record incident start, detection, first fresh indication, monitoring acceptance and trusted configuration snapshot times with timezone.
2. Calculate monitoring interruption = acceptance minus agreed incident start; compare with the separately agreed RTO.
3. Calculate recovery-point age = incident start minus snapshot; compare with the separately agreed RPO.
4. Record actual results and assumptions. This exercise restores configuration only, not process history or a SCADA database; snapshot age is not proof of actual data loss.
Control and protection acceptance are separate from monitoring.
EOF
    ;;
  4E)
    cat <<'EOF'
Design a 3-2-1 backup strategy
1. Identify at least three copies, two different media/storage types and one offsite copy; assign owner and retention.
2. Add independent integrity/provenance checks, access protection, offline/immutable options and periodic restore tests.
3. Identify which configuration, history and SCADA data each copy covers; compare RPO and RTO.
The exercise's active file and backup share a host and directory: they are not a 3-2-1 implementation.
EOF
    ;;
  *)
    echo "Unknown activity. Use one of the desktop launchers (1A-1B, 2A-2G, 3A-3C, 4A-4E)." >&2
    exit 2
    ;;
esac
