import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { operate, state } from './instructor-control.mjs';
import { yardTelemetry } from '../web/yard/telemetry.mjs';

const project = process.env.COMPOSE_PROJECT_NAME;
assert.ok(project && /^ss01-scenarios-[a-z0-9-]+$/.test(project),
  'Use a uniquely named ss01-scenarios-* isolated Compose project.');
const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const compose = async (...args) => (await exec('docker', ['compose', ...args], {
  cwd: root, env: process.env, timeout: 15000,
})).stdout.trim();
const instructor = async action => (await exec(process.execPath, ['containers/instructor.mjs', action], {
  cwd: root, env: process.env, timeout: 60000,
})).stdout;
const endpoint = async (service, port) => {
  const address = await compose('port', service, String(port));
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  return 'http://' + address;
};
const hmi = await endpoint('station-hmi', 8080);
const plant = await endpoint('plant', 8090);
const masters = [
  await endpoint('control-centre', 8090),
  await endpoint('control-centre-dnp3', 8090),
];

async function waitFor(origin, description, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  let lastError;
  while (Date.now() < deadline) {
    try {
      last = (await state(origin)).points;
      if (predicate(last)) return last;
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`${description}: ${JSON.stringify(last)}`, { cause: lastError });
}

async function reset() {
  assert.match(await instructor('reset'), /Baseline verified/);
}

async function yardFault(action) {
  const response = await fetch(plant + '/scenario/' + action, {
    method: 'POST', headers: { Origin: plant }, signal: AbortSignal.timeout(4000),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { action, result: 'APPLIED' });
}

async function checkYard(description, predicate) {
  const deadline = Date.now() + 10000;
  let readings;
  while (Date.now() < deadline) {
    const [snapshot, response] = await Promise.all([
      state(plant), fetch(plant + '/yard/indications', { signal: AbortSignal.timeout(3000) }),
    ]);
    assert.equal(response.status, 200);
    const indications = await response.json();
    assert.equal(indications.directInput, false);
    readings = yardTelemetry(snapshot, Date.now(), indications);
    if (predicate(readings)) return;
    await delay(200);
  }
  assert.fail(description + ': ' + JSON.stringify(readings));
}
async function runCase(name, action) {
  console.log(`START ${name} ${new Date().toISOString()}`);
  await action();
  console.log(`PASS ${name} ${new Date().toISOString()}`);
}

await runCase('baseline and station switching', async () => {
  await reset();
  await operate(hmi, 'open', 'POSITION CONFIRMED');
  await waitFor(hmi, 'open indication', p => p.position?.value === 'OPEN' && p.position.quality === 'GOOD');
  await operate(hmi, 'close', 'POSITION CONFIRMED');
  await waitFor(hmi, 'closed indication', p => p.position?.value === 'CLOSED' && p.position.quality === 'GOOD');
});

await runCase('fault trip, latched clear and reset', async () => {
  await yardFault('fault');
  await waitFor(hmi, 'trip and contact-confirmed open', p =>
    p.trip?.value === true && p.trip.quality === 'GOOD' &&
    p.position?.value === 'OPEN' && p.position.quality === 'GOOD' &&
    p.current?.value === 0 && p.current.quality === 'GOOD');
  await checkYard('active fault with confirmed open contacts and live upstream bus', y =>
    y.fault === true && y.position === 'OPEN' && y.contactA === false && y.contactB === true &&
    y.current === 0 && y.energized === true && y.relayTrip === true && y.breakerPosition === 'OPEN');
  for (const master of masters) {
    await waitFor(master, 'remote trip and open', p =>
      p.trip?.value === true && p.trip.quality === 'GOOD' &&
      p.position?.value === 'OPEN' && p.position.quality === 'GOOD');
  }
  await yardFault('clear');
  await waitFor(hmi, 'trip remains latched after clear', p => p.trip?.value === true &&
    p.trip.quality === 'GOOD' && p.position?.value === 'OPEN');
  await reset();
});

await runCase('stuck breaker and operation failure', async () => {
  await instructor('stuck');
  await yardFault('fault');
  await waitFor(hmi, 'stuck breaker failure', p => p.trip?.value === true &&
    p.position?.value === 'CLOSED' && p.position.quality === 'GOOD' &&
    p.operationFailure?.value === true && p.operationFailure.quality === 'GOOD');
  await checkYard('stuck mechanism retains closed contacts and fault current', y =>
    y.position === 'CLOSED' && y.contactA === true && y.contactB === false &&
    y.fault === true && y.current === 1200 && y.relayTrip === true &&
    y.breakerPosition === 'CLOSED' && y.operationFailure === true);
  for (const master of masters) {
    await waitFor(master, 'remote operation failure', p => p.operationFailure?.value === true &&
      p.operationFailure.quality === 'GOOD' && p.position?.value === 'CLOSED');
  }
  await reset();
});

await runCase('mid-travel stall and restoration', async () => {
  await instructor('stall');
  await instructor('fault');
  await waitFor(hmi, 'stalled position invalid and operation failure', p =>
    p.operationFailure?.value === true && p.operationFailure.quality === 'GOOD' &&
    p.position?.quality === 'INVALID');
  await checkYard('both auxiliary contacts remain off past the travel window', y =>
    y.position === 'STALLED' && y.contactA === false && y.contactB === false);
  await instructor('normal');
  await reset();
});

await runCase('contradictory contacts and restoration', async () => {
  await instructor('contacts-invalid');
  await waitFor(hmi, 'contradictory contacts invalid', p => p.position?.quality === 'INVALID');
  await checkYard('both auxiliary contacts on are contradictory', y =>
    y.position === 'INVALID CONTACTS' && y.contactA === true && y.contactB === true);
  for (const master of masters) {
    await waitFor(master, 'remote invalid position', p => p.position?.quality === 'INVALID');
  }
  await instructor('normal');
  await waitFor(hmi, 'recovered position', p => p.position?.quality === 'GOOD');
  await reset();
});

console.log('PASS all plant-MMS scenario cases');
