# F01 instructor scenarios

Run from the project directory with Node.js 20 or later and a running Compose stack. The commands use the simulator's existing local scenario input. They act on the Compose project selected by `COMPOSE_PROJECT_NAME`.

**Profile prerequisite:** The fault/current and automatic reset expectations
below are for the plant-MMS process-input profile. In direct HTTP mode, plant
fault commands do not change PRF01's injected current, and input expires if
the HMI stops renewing it. Do not assume these scripts will trip or restore
that profile; follow the [HTTP input procedure](container-bench.md#direct-http-process-input-exercise)
and verify each indication. These commands change the selected project: use
an authorized isolated fixture and verify the project name before running.

Start the local instructor console with `node containers/instructor-web.mjs`, then open `http://127.0.0.1:8091/`. Set `LAB_INSTRUCTOR_PORT` to select another port. The console runs its backend on the host and calls the same instructor workflow as the command line. It exposes actions for the selected Compose project and records results in `outputs/instructor-history.jsonl`.

Instructor history retains a current file and one rotated file, each at most
1 MiB after a write; older entries are discarded on rotation. An existing
oversized file is reduced to its most recent complete lines on the next
write. The console reads at most 1 MiB from each file and displays the latest
30 matching actions. Export any history needed for evidence before it rotates.
Writes use `instructor-history.jsonl.lock` to serialize concurrent commands.
If a command terminates abruptly and leaves the lock behind, verify no
instructor command is running before manually removing that specific lock
file. History write or read errors are reported rather than silently ignored.
Restart an already running instructor console to load the updated bounded reader.

```powershell
node containers/instructor.mjs fault
node containers/instructor.mjs reset
```

| Command | Simulator action | Expected observation |
| --- | --- | --- |
| `fault` | Apply a feeder fault | Protection trips and BRF01 opens over GOOSE. |
| `clear` | Clear the simulated fault | Current and protection input recover. A latched protection trip still requires reset. |
| `stuck` | Prevent breaker movement | A subsequent operation times out and raises operation failure. |
| `stall` | Stall a movement in transit | Intermediate contacts are followed by movement failure. |
| `contacts-invalid` | Assert contradictory contacts | Breaker position becomes invalid. |
| `normal` | Restore normal mechanism and contacts | Simulator returns to its last settled position. |
| `gateway-stop` | Stop the IEC 104 gateway | Its control centre marks received position stale. GOOSE continues on the station bus. |
| `gateway-start` | Start the IEC 104 gateway | The control centre reconnects and recovers its points. |
| `reset` | Clear the fault, restore the mechanism, reset protection, and reconcile breaker state | CLOSED, approximately 118–122 A, good quality, clear trip, latch and operation-failure indications. |

Scenario commands acknowledge that SIMF01 applied the input. Observe device and station indications to confirm downstream behavior. The `reset` command waits for and checks the listed baseline. It uses the station HMI's normal switching path and live GOOSE permissive. A failed or unavailable device causes a timeout or rejected operation instead of a success result.

Example for a failed opening:

```powershell
node containers/instructor.mjs stuck
node containers/instructor.mjs fault
# Wait for the breaker operation-failure indication and inspect the HMI.
node containers/instructor.mjs reset
```

The commands print timestamped acknowledgements to the instructor terminal and record success or failure in the history. Reset starts the IEC 104 gateway and verifies the baseline at each running gateway and remote master. Other communication-loss scenarios remain to be implemented. The browser console has been exercised through its HTTP endpoints; a visual browser walkthrough remains outstanding.

For an acceptance check on a prepared training stack, run `node containers/instructor-smoke.mjs`. It applies a fault, tests automatic GOOSE opening, resets the bay, stops the IEC 104 gateway, checks stale quality, and restores the baseline. The test changes the selected stack's scenario state.
