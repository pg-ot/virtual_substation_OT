import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const points = {
  position: { source: 'BRF01LD0/XCBR1.Pos', accepts: value => ['OPEN', 'CLOSED', 'INTERMEDIATE'].includes(value) },
  operationFailure: { source: 'BRF01LD0/GGIO1.Ind1', accepts: value => typeof value === 'boolean' },
  closeInhibited: { source: 'BRF01LD0/GGIO1.Ind2', accepts: value => typeof value === 'boolean' },
  trip: { source: 'PRF01LD0/PTRC1.Tr', accepts: value => typeof value === 'boolean' },
  current: { source: 'PRF01LD0/MMXU1.A.phsA', accepts: Number.isFinite },
};

function indications(sample) {
  return Object.fromEntries(Object.entries(points).map(([name, { source, accepts }]) => {
    const point = sample?.[name];
    const hasValue = accepts(point?.value) && point.sourceTimeMs > 0;
    return [name, {
      source,
      value: hasValue && point.quality === 0 ? point.value : null,
      quality: !sample ? 'UNKNOWN' : hasValue && point.quality === 0 ? 'GOOD' : 'INVALID',
      sourceTimeMs: point?.sourceTimeMs > 0 ? point.sourceTimeMs : null,
    }];
  }));
}

export async function startNativeStation(buildDirectory) {
  const executable = resolve(buildDirectory, process.platform === 'win32' ? 'station-client.exe' : 'station-client');
  await access(executable);
  const controlEnabled = process.env.LAB_PROCESS_MODEL === '1';
  const state = { reader: 'STARTING', points: indications(), events: [], command: null };
  let reader;
  let retry;
  let timeout;
  let stopping = false;
  let controlInProgress = false;

  async function operate(action) {
    if (controlInProgress) return { status: 409, result: 'BUSY' };
    controlInProgress = true;
    const reset = action === 'reset-latch';
    const point = reset ? 'closeInhibited' : 'position';
    const previous = state.points[point];
    const target = reset ? false : action === 'open' ? 'OPEN' : 'CLOSED';
    const requestedAt = Date.now();
    const record = result => {
      state.command = { action, result, requestedAt };
      return state.command;
    };
    record('REQUESTED');
    try {
      const output = await new Promise(resolve => {
        execFile(executable, [action], {
          env: { ...process.env, LAB_DISTRIBUTED: '1' }, timeout: 3000, windowsHide: true,
        }, (_error, stdout) => resolve(stdout));
      });
      if (!/^command=ACCEPTED$/m.test(output)) {
        const rejected = /^command=REJECTED$/m.test(output);
        return { status: rejected ? 409 : 503, ...record(rejected ? 'REJECTED' : 'NO CONTROL RESPONSE') };
      }
      record('ACCEPTED');
      const deadline = Date.now() + 2000;
      while (!stopping && Date.now() < deadline) {
        const feedback = state.points[point];
        if (feedback.quality === 'GOOD' && feedback.value === target &&
            feedback.sourceTimeMs > (previous.sourceTimeMs ?? 0)) {
          return { status: 200, ...record(reset ? 'LATCH RESET CONFIRMED' : 'POSITION CONFIRMED'),
            sourceTimeMs: feedback.sourceTimeMs };
        }
        await delay(75);
      }
      return { status: 504, ...record(reset ? 'LATCH RESET NOT CONFIRMED' : 'POSITION NOT CONFIRMED') };
    } finally {
      controlInProgress = false;
    }
  }

  function update(readerStatus, sample) {
    const next = indications(sample);
    const observedAt = Date.now();
    for (const [point, indication] of Object.entries(next)) {
      const previous = state.points[point];
      if (indication.value === previous.value && indication.quality === previous.quality) continue;
      state.events.unshift({ point, observedAt, ...indication });
    }
    state.events.length = Math.min(state.events.length, 100);
    state.reader = readerStatus;
    state.points = next;
  }

  function connect() {
    reader = spawn(executable, ['stream'], {
      env: { ...process.env, LAB_DISTRIBUTED: '1' },
      stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
    });
    const child = reader;
    const lines = createInterface({ input: child.stdout });
    const armTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        update('UNAVAILABLE');
        child.kill('SIGKILL');
      }, 6000);
    };
    armTimeout();
    lines.on('line', line => {
      if (stopping) return;
      let sample;
      try { sample = JSON.parse(line); } catch { return; }
      if (!sample?.position || !sample.trip || !sample.current) return;
      update('READING', sample);
      armTimeout();
    });
    child.on('error', error => console.error('Station MMS reader:', error.message));
    child.once('close', () => {
      lines.close();
      clearTimeout(timeout);
      if (stopping) return;
      update('UNAVAILABLE');
      retry = setTimeout(connect, 1000);
    });
  }

  connect();
  return {
    controlEnabled,
    operate,
    state: () => state,
    stop() {
      stopping = true;
      clearTimeout(retry);
      clearTimeout(timeout);
      reader.kill();
    },
  };
}
