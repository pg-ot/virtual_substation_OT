import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { operate, state } from './instructor-control.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const compose = async (...args) => (await exec('docker', ['compose', ...args], { cwd: root, timeout: 20000 })).stdout.trim();
const published = await compose('port', 'station-hmi', '8080');
assert.match(published, /^127\.0\.0\.1:\d+$/);
const origin = 'http://' + published;

async function waitFor(predicate, label, endpoint = origin) {
  const deadline = Date.now() + 20000;
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint + '/state', { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        last = (await response.json()).points;
        if (predicate(last)) return;
      }
    } catch {}
    await delay(250);
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

const goodPosition = p => p.position?.quality === 'GOOD' && ['OPEN', 'CLOSED'].includes(p.position.value);
const goodTrip = p => p.trip?.quality === 'GOOD' && typeof p.trip.value === 'boolean';
const masters = [];
for (const service of ['control-centre', 'control-centre-dnp3']) {
  if (!await compose('ps', '-q', service)) continue;
  const address = await compose('port', service, '8090');
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  masters.push({ service, origin: 'http://' + address });
}
const goodLatch = p => p.closeInhibited?.quality === 'GOOD' && typeof p.closeInhibited.value === 'boolean';
const goodCurrent = p => p.current?.quality === 'GOOD' && Number.isFinite(p.current.value);

try {
  await waitFor(p => goodPosition(p) && goodTrip(p), 'initial HMI state');
  for (let run = 1; run <= 3; run++) {
    await compose('stop', 'breaker');
    await waitFor(p => p.position?.quality !== 'GOOD' && goodTrip(p), `breaker loss ${run}`);
    for (const master of masters) {
      await waitFor(p => p.position?.quality === 'INVALID' && p.closeInhibited?.quality === 'INVALID',
        `${master.service} breaker loss ${run}`, master.origin);
    }
    if (run === 2) await compose('restart', 'station-hmi');
    await compose('start', 'breaker');
    await waitFor(p => goodPosition(p) && goodTrip(p), `breaker recovery ${run}`);
    for (const master of masters) {
      await waitFor(p => goodPosition(p) && goodLatch(p), `${master.service} breaker recovery ${run}`, master.origin);
    }
    console.log(`Breaker recovery ${run} passed${run === 2 ? ' with HMI started during outage' : ''}.`);
  }
  await compose('stop', 'protection');
  await waitFor(p => p.trip?.quality !== 'GOOD' && goodPosition(p), 'protection loss');
  for (const master of masters) {
    await waitFor(p => p.trip?.quality === 'INVALID' && p.current?.quality === 'INVALID' && goodPosition(p),
      `${master.service} protection loss`, master.origin);
  }
  await compose('start', 'protection');
  await waitFor(p => goodPosition(p) && goodTrip(p), 'protection recovery');
  for (const master of masters) {
    await waitFor(p => goodPosition(p) && goodTrip(p) && goodCurrent(p),
      `${master.service} protection recovery`, master.origin);
  }
  console.log('Protection loss and recovery passed without restarting the HMI.');

  const beforeInterlock = (await state(origin)).points;
  if (beforeInterlock.position.value === 'CLOSED') await operate(origin, 'open', 'POSITION CONFIRMED');
  if ((await state(origin)).points.closeInhibited?.value === true)
    await operate(origin, 'reset-latch', 'LATCH RESET CONFIRMED');
  await compose('stop', 'protection');
  await waitFor(p => p.trip?.quality === 'INVALID' && p.position?.value === 'OPEN', 'protection interlock input loss');
  // The last clear GOOSE message remains valid until its advertised lifetime expires.
  await delay(4000);
  const rejection = await fetch(origin + '/control/close', {
    method: 'POST', headers: { Origin: origin }, signal: AbortSignal.timeout(12000),
  });
  const result = await rejection.json();
  assert.equal(rejection.status, 409);
  assert.equal(result.result, 'REJECTED');
  await waitFor(p => p.position?.value === 'OPEN' && p.position.quality === 'GOOD', 'breaker remains open');
  const remote = masters.find(master => master.service === 'control-centre');
  if (process.env.LAB_TEST_IEC104_CONTROL === '1') {
    assert.ok(remote, 'IEC 104 control centre is required');
    const response = await fetch(remote.origin + '/control/close', {
      method: 'POST', headers: { Origin: remote.origin }, signal: AbortSignal.timeout(16000),
    });
    const remoteResult = await response.json();
    assert.equal(response.status, 409);
    assert.equal(remoteResult.result, 'REJECTED OR NOT CONFIRMED');
    await waitFor(p => p.position?.value === 'OPEN' && p.position.quality === 'GOOD', 'remote close remains open');
  }
  await compose('start', 'protection');
  await waitFor(p => goodTrip(p) && p.trip.value === false, 'protection permissive recovery');
  if (process.env.LAB_TEST_IEC104_CONTROL === '1') {
    await operate(remote.origin, 'close', 'POSITION CONFIRMED');
    await waitFor(p => p.position?.value === 'CLOSED' && p.position.quality === 'GOOD', 'remote close feedback');
  } else await operate(origin, 'close', 'POSITION CONFIRMED');
  console.log('Close was rejected with expired protection permissive and succeeded after recovery.');
} finally {
  await compose('start', 'breaker').catch(error => console.error('Breaker restore failed:', error.message));
  await compose('start', 'protection').catch(error => console.error('Protection restore failed:', error.message));
}
