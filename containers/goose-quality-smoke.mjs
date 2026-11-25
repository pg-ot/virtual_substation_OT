import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { operate, state } from './instructor-control.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const docker = async (...args) => (await exec('docker', args, { cwd: root, timeout: 15000 })).stdout.trim();
const compose = (...args) => docker('compose', ...args);
const address = await compose('port', 'station-hmi', '8080');
assert.match(address, /^127\.0\.0\.1:\d+$/);
const origin = 'http://' + address;
const protection = await compose('ps', '-q', 'protection');
const plant = await compose('ps', '-q', 'plant');
assert.ok(protection && plant, 'Plant and protection must be running');
const inspect = JSON.parse(await docker('inspect', protection, plant));
const networks = Object.keys(inspect[0].NetworkSettings.Networks)
  .filter(name => name.endsWith('_process') && Object.hasOwn(inspect[1].NetworkSettings.Networks, name));
assert.equal(networks.length, 1, 'Expected one shared process network');
const network = networks[0];

async function until(label, probe) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if (await probe()) return; } catch {}
    await delay(200);
  }
  throw new Error('Timed out waiting for ' + label);
}

let disconnected = false;
try {
  const baseline = (await state(origin)).points;
  assert.equal(baseline.trip?.value, false);
  assert.equal(baseline.trip?.quality, 'GOOD');
  if (baseline.position?.value === 'CLOSED') await operate(origin, 'open', 'POSITION CONFIRMED');
  if ((await state(origin)).points.closeInhibited?.value === true)
    await operate(origin, 'reset-latch', 'LATCH RESET CONFIRMED');
  await docker('network', 'disconnect', network, protection);
  disconnected = true;
  await until('invalid protection trip and current', async () => {
    const points = (await state(origin)).points;
    return points.trip?.quality === 'INVALID' && points.current?.quality === 'INVALID';
  });
  await until('invalid quality GOOSE at BRF01', async () =>
    (await compose('logs', '--since', '15s', '--no-color', '--no-log-prefix', 'breaker'))
      .includes('GOOSE INVALID: protection quality is not good'));
  const response = await fetch(origin + '/control/close', {
    method: 'POST', headers: { Origin: origin }, signal: AbortSignal.timeout(12000),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).result, 'REJECTED');
  assert.equal((await state(origin)).points.position?.value, 'OPEN');
  await docker('network', 'connect', network, protection);
  disconnected = false;
  await until('good protection inputs after recovery', async () => {
    const points = (await state(origin)).points;
    return points.trip?.quality === 'GOOD' && points.trip.value === false && points.current?.quality === 'GOOD';
  });
  await operate(origin, 'close', 'POSITION CONFIRMED');
  console.log('GOOSE quality loss and recovery passed.');
} finally {
  if (disconnected) await docker('network', 'connect', network, protection)
    .catch(error => console.error('Process network restore failed:', error.message));
}
