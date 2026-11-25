# Session 4: IEC 104 configuration recovery

This supervised exercise intentionally misconfigures the **simulated
control-centre IEC 104 client**. Trainees verify a configuration backup
against an instructor-supplied SHA-256 fingerprint, restore it, restart the
client and verify remote monitoring. It does not modify the IEC 104 gateway,
IED protection settings or the running lab's default configuration.

Use a **new disposable project**, not the active trainee lab. The exercise
changes a configuration file and restarts its control-centre container. It
does not demonstrate a real compromise, malware detection, backup of process
history, industrial recovery or IEC 62443 compliance.

## What is actually restored?

| Function | What to check | What this exercise establishes |
|---|---|---|
| Remote visibility | IEC 104 master link and point values/quality; compare with station and gateway | Monitoring is restored when the master reconnects and fresh GOOD indications agree. |
| Remote control | Review the configured profile and authority | IEC 104 switching is a supervised simulation. This exercise does **not** test or establish that remote switching works after the connection is restored. |
| Protection | Inspect the station and PRF01/BRF01 indications | Indications provide context, but do not by themselves prove protection operation. Independently test it only with a separately prepared and supervised protection exercise. |
| Supply | Compare simulated breaker contacts and position | The lab represents a simulated feeder; remote visibility loss alone does not establish a supply interruption. |

After a master restart, its cached point values may be absent rather than
marked STALE. In either case, do not treat an absent or old value as fresh
GOOD information. The misconfigured master loses its IEC 104 communication
path; this exercise does not by itself establish the state of other control
paths or prove local protection or simulated supply.

## Instructor preparation

1. Select a dedicated local Docker host, an unused Compose project name and
   six free loopback ports. Build or otherwise provide the base `ss01-bench:dev`
   image using the [container runbook](container-bench.md). Do not use the
   project running an active class.
2. From the repository root in PowerShell, create a **new**, non-existent
   exercise directory under the existing `outputs` directory:

   ```powershell
   $project = 'ss01-recovery-class'
   $env:LAB_RECOVERY_DIR = Join-Path (Join-Path (Get-Location) 'outputs') 'recovery-class-01'
   node containers\recovery\exercise.mjs prepare $env:LAB_RECOVERY_DIR
   if ($LASTEXITCODE -ne 0) { throw 'Preparation failed; do not start the exercise.' }
   ```

   Preparation refuses an existing directory. It creates `active.json`, a
   separate `approved-backup.json`, and an exercise marker. Record the
   displayed SHA-256 and the snapshot time in the instructor's trusted
   exercise record. Deliver the expected fingerprint to trainees through an
   independent trusted channel; a hash supplied alongside a substituted
   backup is not an independent trust anchor.
3. Configure free ports and start the isolated project:

   ```powershell
   $env:LAB_PLANT_WEB_PORT = '33281'
   $env:LAB_PROTECTION_WEB_PORT = '33282'
   $env:LAB_BREAKER_WEB_PORT = '33283'
   $env:LAB_GATEWAY_WEB_PORT = '33284'
   $env:LAB_CONTROL_CENTRE_WEB_PORT = '33285'
   $env:LAB_HMI_PORT = '33280'
   docker compose -p $project -f compose.yaml -f compose.recovery.yaml up -d control-centre station-hmi
   ```

   Keep the same project, port variables, exercise directory and Compose
   files for the whole exercise. Check `docker compose -p $project -f
   compose.yaml -f compose.recovery.yaml ps`. Check station SCADA at
   `http://127.0.0.1:33280/`, gateway at `http://127.0.0.1:33284/` and
   remote master at `http://127.0.0.1:33285/`. Wait for the master to show
   connected/fresh GOOD position, trip and current; compare with the station.
   Record the baseline and snapshot time. This uses the base plant-MMS
   input; it is not the direct-HTTP pilot.

The overlay reads the host exercise directory at container startup, without
rebuilding the existing lab image. Its recovery runner accepts only the
training gateway hostname and a valid port. It does not reload file changes
until the control-centre is restarted.

## Exercise

### 1. Inject and assess

Instructor:

```powershell
node containers\recovery\exercise.mjs inject $env:LAB_RECOVERY_DIR
if ($LASTEXITCODE -ne 0) { throw 'Injection failed; do not restart the master.' }
docker compose -p $project -f compose.yaml -f compose.recovery.yaml restart control-centre
if ($LASTEXITCODE -ne 0) { throw 'Master restart failed.' }
```

The injection changes the master port from 2404 to 2405. Record the time the
service is interrupted and when trainees confirm loss of fresh remote
indications. The gateway and station should remain independently accessible.
Check the master link and compare point quality or absence with the station
and gateway. An unused wrong port is assumed; if an unexpected service is
listening there, stop and investigate rather than claiming the fault worked.

Trainees record: what is lost, what is still observable, what is unknown,
potential operational impact, and who can approve recovery. Do not infer
that a protection function or physical supply is healthy solely from the
communications outage.

### 2. Verify and restore

The instructor supplies the backup file and the independently communicated
trusted fingerprint. Trainees compare the SHA-256 **before** applying it:

```powershell
$backup = Join-Path $env:LAB_RECOVERY_DIR 'approved-backup.json'
$trustedHash = '<64-character fingerprint from the instructor>'
Get-FileHash -Algorithm SHA256 $backup
node containers\recovery\exercise.mjs verify $backup $trustedHash
if ($LASTEXITCODE -ne 0) { throw 'Verification failed; do not restore.' }
```

Compare both the full digest and its trusted source. A mismatch must stop
recovery; obtain a trusted copy and investigate. A matching hash proves that
the bytes match the trusted fingerprint, not that the file is malware-free,
appropriate for every device, authentic without a trusted fingerprint, or
that the system is clean.

After authorization, restore and restart:

```powershell
node containers\recovery\exercise.mjs restore $env:LAB_RECOVERY_DIR $backup $trustedHash
if ($LASTEXITCODE -ne 0) { throw 'Restore failed; do not restart the master.' }
docker compose -p $project -f compose.yaml -f compose.recovery.yaml restart control-centre
if ($LASTEXITCODE -ne 0) { throw 'Master restart failed.' }
```

**Stop if either command fails.** The restore checks the hash again, validates
the expected training gateway and port, then replaces `active.json` using the
verified bytes. It does not restart the process itself. The application of
the restored file is a separate, observable step.

### 3. Validate and accept

Confirm master link `TRANSFERRING`, fresh GOOD position, trip and current,
and agreement with station/gateway indications. Record the first restored
indication and the later instructor acceptance/sign-off separately. Review
logs and the intended configuration; do not close the incident simply
because a web page opens. To assess remote control, after monitoring is
restored the instructor can separately authorise workbook practical 2G in
this disposable project: establish a safe baseline, exercise IEC 104 open
and close and check contact-derived feedback. Record control acceptance
separately; if the test is not performed, mark control unverified. A
protection test is another separate acceptance item.

## Trainee record

| Record | Entry |
|---|---|
| Incident start / detection time | |
| Backup snapshot time and trusted source | |
| Expected SHA-256 / independently calculated SHA-256 | |
| Impact: visibility / control / protection / supply | |
| Recovery authorization / restore and restart times | |
| First fresh GOOD remote indications / sign-off time | |
| RTO target / measured monitoring interruption | |
| RPO target / age of trusted configuration snapshot | |
| Evidence and remaining assumptions | |

## RTO, RPO and 3-2-1

- **RTO** is the target maximum interruption to an agreed service; measure
  the elapsed time from the agreed incident start to acceptance. Here the
  service is **IEC 104 monitoring**, not remote control or protection.
  Detection, first restored indication and acceptance can be different
  times; record each.
- **RPO** is the maximum acceptable age of the recovery point, expressed as
  time. Compare the trusted snapshot time with the incident time and the
  chosen RPO target. Here only a small, static configuration is restored:
  no historical events, process measurements or SCADA database are backed
  up. A 30-minute snapshot gap does not by itself prove 30 minutes of actual
  data loss; identify changes and data that would need separate recovery.
- **Worked discussion:** if monitoring fails at 10:00 and is accepted at
  10:18, the measured interruption is 18 minutes. For an RTO target of
  20 minutes, that exercise meets the target. If the trusted configuration
  snapshot was taken at 09:30, its recovery-point age at the incident is
  30 minutes; compare that with the separately agreed RPO and investigate
  any configuration changes after the snapshot. These are illustrative
  times, not results measured by the tool.
- **3-2-1:** discuss at least three copies, on two different media or storage
  types, with one offsite. Modern practice may add offline or immutable
  copies and regular restore tests. The active file and backup in this
  exercise are on the **same host and directory**: they do not implement
  3-2-1, offline protection or independent provenance.

## Cleanup and verification

When the disposable exercise is finished, confirm `$project` is still the
dedicated exercise project, then stop only its services:

```powershell
docker compose -p $project -f compose.yaml -f compose.recovery.yaml stop
```

Retain the exercise directory and trainee evidence as required by the
instructor. Restart the isolated project with `up` if needed. Do not run
`down` against an existing shared lab.

Run `node --test containers\recovery\exercise.test.mjs` for focused checks of
injection, trusted-hash verification, rejected tampering, preservation of
the active file after rejection and successful restore. To test monitoring
and switching from the current source without replacing a shared image tag,
build a uniquely tagged image and run the isolated scenario:

```powershell
$tag = 'ss01-recovery-test:' + [guid]::NewGuid().ToString('N').Substring(0, 12)
docker build --tag $tag .
if ($LASTEXITCODE -ne 0) { throw 'Test image build failed.' }
$env:IEC104_TEST_IMAGE = $tag
$env:LAB_IEC104_CONTROL = '1'
node --test containers\recovery\scenario-smoke.mjs
if ($LASTEXITCODE -ne 0) { throw 'Recovery and switching test failed; retain the image for investigation.' }
docker image rm $tag
Remove-Item Env:IEC104_TEST_IMAGE
```

The test starts a uniquely named disposable project and removes its own
project and exercise directory. The explicit test image prevents a stale
shared `ss01-bench:dev` image from silently being selected. Before class,
an instructor must still rehearse the complete scenario on the selected host.
