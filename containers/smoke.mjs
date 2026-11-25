import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dnp3 = process.argv.includes('--dnp3');
const normalCurrent = value => Number.isFinite(value) && value >= 117.9 && value <= 122.1;
const normalVoltage = value => Number.isFinite(value) && value >= 10.95 && value <= 11.05;
const cli = promisify(execFile);
const compose = async (...args) => (await cli('docker',
  ['compose',
    ...(dnp3 ? ['--profile', 'dnp3'] : []), ...args], { cwd: root, timeout: 12000 })).stdout.trim();
const attachments = [];

async function attach(service) {
  const id = await compose('ps', '--quiet', service);
  assert.ok(id, 'Start the Compose service first: ' + service);
  const child = spawn('docker', ['attach', '--sig-proxy=false', id], { cwd: root, stdio: 'pipe' });
  const attached = { child, output: '' };
  for (const emitter of [child, child.stdin]) emitter.on('error', error => { attached.output += error.message; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { attached.output += chunk; });
  attachments.push(attached);
  return attached;
}

function action(target, ...commands) {
  assert.equal(target.child.exitCode, null, target.output);
  target.child.stdin.write(commands.join('\n') + '\n');
}

async function until(label, probe) {
  const end = Date.now() + 18000;
  let error;
  while (Date.now() < end) {
    try {
      if (await probe()) return;
    } catch (failure) {
      error = failure;
    }
    await delay(200);
  }
  throw new Error('Timed out waiting for ' + label + '\n' +
    attachments.map(({ output }) => output).join('\n'), { cause: error });
}

const logs = service => compose('logs', '--no-color', '--no-log-prefix', service);

try {
  const address = await compose('port', 'station-hmi', '8080');
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const origin = 'http://' + address;
  const url = origin + '/state';
  const pointState = (label, predicate) => until(label, async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    assert.ok(response.ok);
    return predicate((await response.json()).points);
  });
  const breakerRead = () => compose('exec', '-T', 'breaker', 'breaker-read');
  const plantRead = () => compose('exec', '-T', 'plant', 'plant-read');
  const viewOrigins = new Map();
  const component = (id, predicate) => until(id + ' component readback', async () => {
    const response = await fetch(viewOrigins.get(id) + '/state', { signal: AbortSignal.timeout(3500) });
    assert.ok(response.ok);
    const state = await response.json();
    assert.equal(state.component, id);
    return state.service === 'RUNNING' && predicate(state.points);
  });
  const plant = await attach('plant');
  const relay = await attach('protection');
  const breaker = await attach('breaker');
  await pointState('fresh CLOSED baseline', p => p.position.value === 'CLOSED' &&
    p.position.source === 'BRF01LD0/XCBR1.Pos' && p.trip.value === false && normalCurrent(p.current.value));
  const stationPage = await fetch(origin);
  assert.match(stationPage.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(await stationPage.text(), /11 kV single-line/);
  assert.equal((await fetch(origin + '/components/breaker')).status, 404);
  assert.equal((await fetch(origin + '/api/components/breaker')).status, 404);
  const views = ['plant', 'protection', 'breaker', 'gateway', 'control-centre'];
  if (dnp3) views.push('gateway-dnp3', 'control-centre-dnp3');
  for (const id of views) {
    const published = await compose('port', id, '8090');
    assert.match(published, /^127\.0\.0\.1:\d+$/);
    const endpoint = 'http://' + published;
    assert.ok(endpoint !== origin && ![...viewOrigins.values()].includes(endpoint), 'Duplicate web origin: ' + id);
    viewOrigins.set(id, endpoint);
    const page = await fetch(endpoint);
    assert.ok(page.ok);
    assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.ok((await page.text()).includes('data-component="' + id + '"'), 'Incorrect faceplate: ' + id);
    assert.equal((await fetch(endpoint + '/state', { method: 'POST' })).status, 405);
  }
  const yard = viewOrigins.get('plant') + '/yard/';
  const yardPage = await (await fetch(yard)).text();
  assert.match(yardPage, /F01 switchyard and control room/);
  assert.match(yardPage, /data-view="walk-room"/);
  assert.match(yardPage, /data-view="metering"/);
  assert.match(yardPage, /Inject overcurrent/);
  const plantOrigin = viewOrigins.get('plant');
  assert.equal((await fetch(plantOrigin + '/scenario/fault', {
    method: 'POST', headers: { Origin: 'http://example.invalid' },
  })).status, 403);
  const wasm = await fetch(yard + 'yard.wasm', { method: 'HEAD' });
  assert.equal(wasm.status, 200);
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal((await fetch(viewOrigins.get('breaker') + '/yard/')).status, 404);
  await Promise.all([
    component('plant', p => p.contactA?.value === true && normalVoltage(p.voltage?.value)),
    component('protection', p => p.trip?.value === false && normalCurrent(p.current?.value)),
    component('breaker', p => p.position?.value === 'CLOSED' && p.operationFailure?.value === false),
    ...views.filter(id => id.startsWith('gateway') || id.startsWith('control-centre')).map(id =>
      component(id, p => p.position?.value === 'CLOSED' && normalCurrent(p.current?.value))),
  ]);
  await until('IEC 104 general interrogation', async () => /GI breaker=CLOSED quality=0/.test(await logs('control-centre')));
  await component('control-centre', p => p.closeInhibited?.value === false && p.closeInhibited.quality === 'GOOD');
  if (dnp3) await component('control-centre-dnp3', p => p.closeInhibited?.value === false && p.closeInhibited.quality === 'GOOD');
  if (dnp3) await until('DNP3 integrity response', async () =>
    /DETERMINED_ON/.test(await logs('control-centre-dnp3')));

  const priorAcceptedOpens = (await logs('plant')).match(/Plant accepted OPEN/g)?.length ?? 0;
  const firstGoose = breaker.output.length;
  const injection = await fetch(plantOrigin + '/scenario/fault', {
    method: 'POST', headers: { Origin: plantOrigin },
  });
  assert.equal(injection.status, 200);
  assert.equal((await injection.json()).result, 'APPLIED');
  await until('asserted trip received by BRF01 over GOOSE', () =>
    /GOOSE LIVE [^\r\n]+trip=1/.test(breaker.output.slice(firstGoose)));
  await pointState('contact-confirmed OPEN and zero current', p => p.position.value === 'OPEN' &&
    p.trip.value === true && p.current.value === 0);
  await component('control-centre', p => p.position?.value === 'OPEN' && p.current?.value === 0);
  await component('control-centre', p => p.closeInhibited?.value === true && p.closeInhibited.quality === 'GOOD' &&
    Number.isFinite(p.closeInhibited.sourceTimeMs) && p.closeInhibited.sourceTimeMs > 0);
  if (dnp3) await component('control-centre-dnp3', p => p.closeInhibited?.value === true &&
    p.closeInhibited.quality === 'GOOD' && Number.isFinite(p.closeInhibited.sourceTimeMs) && p.closeInhibited.sourceTimeMs > 0);
  assert.match(await plantRead(), /52a=0 52b=1 fault=1 source_kV=\S+ feeder_A=0/);
  for (const command of ['reset-latch', 'close']) {
    const response = await fetch(origin + '/control/' + command, {
      method: 'POST', headers: { Origin: origin },
    });
    assert.equal(response.status, 409, `${command} must be rejected during the fault`);
    assert.equal((await response.json()).result, 'REJECTED');
  }
  await pointState('breaker remains open while fault is active', p =>
    p.position.value === 'OPEN' && p.position.quality === 'GOOD' && p.trip.value === true);
  await until('IEC 104 OPEN event', async () => /EVENT breaker=OPEN quality=0/.test(await logs('control-centre')));
  if (dnp3) await until('DNP3 OPEN event', async () =>
    /DETERMINED_OFF/.test(await logs('control-centre-dnp3')));

  const clearance = await fetch(plantOrigin + '/scenario/clear', {
    method: 'POST', headers: { Origin: plantOrigin },
  });
  assert.equal(clearance.status, 200);
  assert.equal((await clearance.json()).result, 'APPLIED');
  await until('fault clearance at PRF01', () => /Process fault cleared/.test(relay.output));
  const clearGoose = breaker.output.length;
  action(relay, 'reset');
  await pointState('deasserted trip with breaker still OPEN', p => p.position.value === 'OPEN' && p.trip.value === false);
  await until('fresh deasserted GOOSE at BRF01', () =>
    /GOOSE LIVE [^\r\n]+trip=0/.test(breaker.output.slice(clearGoose)));
  action(breaker, 'reset', 'close');
  await pointState('reclosed breaker', p => p.position.value === 'CLOSED' && p.trip.value === false);

  action(plant, 'stuck', 'fault');
  await pointState('second trip with fault current', p => p.position.value === 'CLOSED' &&
    p.trip.value === true && Math.abs(p.current.value - 1200) < 1);
  await until('CLOSED with an operation-failure alarm', async () =>
    /breaker=CLOSED quality=0[^\r\n]*[\r\n]+operation_failure=1/.test(await breakerRead()));
  await component('breaker', p => p.position?.value === 'CLOSED' && p.operationFailure?.value === true);
  await pointState('station breaker operation failure', p => p.operationFailure?.value === true);
  await component('control-centre', p => p.operationFailure?.value === true);
  if (dnp3) await component('control-centre-dnp3', p => p.operationFailure?.value === true);
  assert.match(await plantRead(), /52a=1 52b=0 fault=1 source_kV=\S+ feeder_A=1200/);
  assert.equal(((await logs('plant')).match(/Plant accepted OPEN/g)?.length ?? 0) - priorAcceptedOpens, 2);
  console.log('Compose acceptance passed: successful and failed trips, independent MMS feedback, and supervisory monitoring.');
} finally {
  for (const { child } of attachments) child.kill();
}
