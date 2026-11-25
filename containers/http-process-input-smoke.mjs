import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { operate } from './instructor-control.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = process.env.COMPOSE_PROJECT_NAME;
assert.ok(project && /http/i.test(project) && project !== 'ss01-bench',
  'Run only in a uniquely named isolated HTTP-input Compose project.');
const exec = promisify(execFile);
const compose = async (...args) => (await exec('docker', ['compose', ...args], {
  cwd: root, env: process.env, timeout: 15000,
})).stdout.trim();

const protectionPort = await compose('port', 'protection', '8090');
const hmiPort = await compose('port', 'station-hmi', '8080');
const plantPort = await compose('port', 'plant', '8090');
assert.match(protectionPort, /^127\.0\.0\.1:\d+$/);
assert.match(hmiPort, /^127\.0\.0\.1:\d+$/);
assert.match(plantPort, /^127\.0\.0\.1:\d+$/);
const endpoint = `http://${protectionPort}/process-input`;
const hmi = `http://${hmiPort}`;
const stationInput = hmi + '/process-input';
const plant = `http://${plantPort}`;
const origin = new URL(hmi).origin;
const headers = { Origin: origin };
const primaryOwner = randomUUID();
const alternateOwner = randomUUID();

const pageResponse = await fetch(hmi);
assert.equal(pageResponse.status, 200);
const page = await pageResponse.text();
assert.ok(page.includes('data-process-input-url="/process-input"'));
assert.match(page, /BRF01 contact feedback read over MMS/);
assert.ok(!pageResponse.headers.get('content-security-policy').includes(new URL(endpoint).origin));
assert.match(page, /Run 120/);
assert.match(page, /Breaker faceplate[\s\S]*id="reset-protection-trip"[\s\S]*data-action="reset-latch"[\s\S]*data-action="close"/);
assert.equal(page.match(/id="reset-protection-trip"/g)?.length, 1);

const preflight = await fetch(endpoint, {
  method: 'OPTIONS',
  headers: { ...headers, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
});
assert.equal(preflight.status, 403, 'Direct browser input must be blocked at the protection port');
assert.equal((await fetch(endpoint, {
  method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ currentA: 120 }),
})).status, 403, 'A legacy tab must not submit directly to the protection port');

assert.equal((await fetch(stationInput, {
  method: 'POST', headers: { Origin: 'http://example.invalid', 'Content-Type': 'application/json' },
  body: JSON.stringify({ currentA: 120 }),
})).status, 403);
assert.equal((await fetch(stationInput, {
  method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '120',
})).status, 415);
for (const [payload, status] of [
  ['{"currentA":', 400],
  ['{"currentA":"120"}', 422],
  ['{"currentA":null}', 422],
  ['{"currentA":1e309}', 422],
  ['{"currentA":-0.1}', 422],
  ['{"currentA":1200.1}', 422],
]) {
  const response = await fetch(stationInput, {
    method: 'POST', headers: {
      ...headers, 'Content-Type': 'application/json',
      'X-SS01-Input-Owner': primaryOwner, 'X-SS01-Input-Action': 'apply',
    },
    body: payload, signal: AbortSignal.timeout(3500),
  });
  assert.equal(response.status, status, payload);
}

const postInput = (path, payload, owner, takeControl = false) =>
  fetch(stationInput + path, {
    method: 'POST',
    headers: {
      ...headers, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin',
      'X-SS01-Input-Owner': owner, ...(takeControl && { 'X-SS01-Input-Action': 'apply' }),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3500),
  });
async function setCurrent(currentA, owner = primaryOwner) {
  const response = await postInput('', { currentA }, owner, true);
  const text = await response.text();
  assert.equal(response.status, 200, text);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const result = JSON.parse(text);
  assert.equal(result.result, 'APPLIED');
  assert.equal(result.currentA, currentA);
}

async function waitFor(description, check, timeoutMs = 10000, service = hmi) {
  const deadline = Date.now() + timeoutMs;
  let points;
  while (Date.now() < deadline) {
    const response = await fetch(service + '/state', { signal: AbortSignal.timeout(1500) });
    assert.equal(response.status, 200);
    ({ points } = await response.json());
    if (check(points)) return points;
    await delay(100);
  }
  assert.fail('Timed out waiting for ' + description + ': ' + JSON.stringify(points));
}

async function setPlantFault(action) {
  const response = await fetch(plant + '/scenario/' + action, {
    method: 'POST', headers: { Origin: plant }, signal: AbortSignal.timeout(4000),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { action, result: 'APPLIED' });
}

const good = (point, value) => point?.quality === 'GOOD' && point.value === value;
async function yardIndications() {
  const response = await fetch(plant + '/yard/indications', { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  const config = await response.json();
  assert.equal(config.directInput, true);
  assert.equal(config.stationWebPort, Number(new URL(hmi).port));
  return config;
}
async function waitForYard(predicate) {
  const deadline = Date.now() + 4500;
  let result;
  while (Date.now() < deadline) {
    result = await yardIndications();
    if (predicate(result)) return;
    await delay(100);
  }
  assert.fail('Yard IED indications did not match: ' + JSON.stringify(result));
}
assert.match(await (await fetch(plant)).text(), /This control changes SIMF01 only/);
await waitFor('closed breaker and invalid PRF01 before the first HTTP input', points =>
  good(points.position, 'CLOSED') && points.current?.quality === 'INVALID' && points.trip?.quality === 'INVALID');
await setPlantFault('fault');
try {
  await waitFor('the yard sees 1200 A and closed contacts', points =>
    good(points.fault, true) && good(points.current, 1200) &&
    good(points.contactA, true) && good(points.contactB, false), 10000, plant);
  const invalid = await waitFor('PRF01 keeps its input invalid while plant fault is active', points =>
    points.current?.quality === 'INVALID' && points.trip?.quality === 'INVALID');
  assert.ok(good(invalid.position, 'CLOSED'));
  await waitForYard(y => y.protection?.current?.quality === 'INVALID' &&
    y.protection.trip?.quality === 'INVALID' && good(y.breaker?.position, 'CLOSED'));
  await setCurrent(120);
  await waitFor('a plant fault cannot replace a valid 120 A HTTP input', points =>
    good(points.current, 120) && good(points.trip, false) && good(points.position, 'CLOSED'));
  await waitFor('plant still reports the separate fault and 1200 A', points =>
    good(points.fault, true) && good(points.current, 1200), 10000, plant);
} finally {
  await setPlantFault('clear');
}
await waitFor('clear process fault', points => good(points.fault, false), 10000, plant);
console.log('PASS HTTP source separation: SIMF01 fault does not supply PRF01 current or operate BRF01.');

await setCurrent(0);
await waitFor('GOOD zero current at the lower input limit', points =>
  good(points.current, 0) && good(points.trip, false) && good(points.position, 'CLOSED'));
await setCurrent(182, alternateOwner);
assert.equal((await postInput('', { currentA: 120 }, primaryOwner)).status, 409,
  'Former owner must not overwrite a new explicit apply');
await waitFor('182 A remains below 200 A pickup and breaker stays closed', points =>
  good(points.current, 182) && good(points.trip, false) && good(points.position, 'CLOSED'));
console.log('PASS competing-tab control and 182 A below pickup.');
await setCurrent(120);
const normal = await waitFor('GOOD normal process current', points =>
  points.current?.quality === 'GOOD' && Math.abs(points.current.value - 120) < 0.1);
assert.equal(normal.position.source, 'BRF01LD0/XCBR1.Pos');
assert.equal(normal.current.source, 'PRF01LD0/MMXU1.A.phsA');
assert.equal(normal.trip.source, 'PRF01LD0/PTRC1.Tr');

await setCurrent(580);
await waitFor('GOOSE trip and subscriber contact feedback', points =>
  good(points.trip, true) && good(points.current, 580) && good(points.position, 'OPEN'), 12000);
await waitForYard(y => good(y.protection?.current, 580) &&
  good(y.protection?.trip, true) && good(y.breaker?.position, 'OPEN'));
const switchRequest = action => fetch(hmi + '/control/' + action, {
  method: 'POST', headers, signal: AbortSignal.timeout(6500),
});
assert.equal((await switchRequest('close')).status, 409);
assert.equal((await postInput('/reset-trip', {}, primaryOwner)).status, 409);
await waitFor('plant OPEN contacts, zero plant current and clear plant fault after HTTP-only trip', points =>
  good(points.contactA, false) && good(points.contactB, true) && good(points.current, 0) && good(points.fault, false),
  10000, plant);
await setCurrent(120);
const latched = await waitFor('latched trip after current clears', points =>
  points.current?.quality === 'GOOD' && Math.abs(points.current.value - 120) < 0.1 &&
  points.trip?.value === true);
assert.equal(latched.position.value, 'OPEN');
const ct = await (await fetch(hmi + '/plant-indications')).json();
assert.ok(good(ct.current, 0), 'The downstream CT reads zero while PRF01 receives injected 120 A');
assert.equal((await switchRequest('reset-latch')).status, 409, 'PRF01 trip must be reset first');

await waitFor('expired process-input lease becomes invalid', points =>
  points.current?.quality === 'INVALID' && points.trip?.quality === 'INVALID' &&
  good(points.position, 'OPEN'), 6000);
await setCurrent(120);
await waitFor('valid 120 A with trip still latched', p => good(p.current, 120) && good(p.trip, true));
const reset = await postInput('/reset-trip', {}, primaryOwner);
const resetResult = await reset.json();
assert.equal(reset.status, 200, JSON.stringify(resetResult));
assert.equal(resetResult.result, 'RESET ACCEPTED');
await waitFor('PRF01 clear and BRF01 latch still set', p => good(p.trip, false) && good(p.closeInhibited, true));
assert.equal((await switchRequest('close')).status, 409, 'Clearing PRF01 must not clear the separate BRF01 latch');
await setCurrent(120);
await operate(hmi, 'reset-latch', 'LATCH RESET CONFIRMED');
await operate(hmi, 'close', 'POSITION CONFIRMED');
await waitFor('closed baseline restored', p => good(p.position, 'CLOSED') && good(p.trip, false) && good(p.closeInhibited, false));
console.log('PASS 580 A trip, blocked close, input expiry, separate PRF01 and BRF01 resets, and confirmed close.');
