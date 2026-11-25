import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { yardTelemetry } from '../web/yard/telemetry.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const [buildDirectory] = process.argv.slice(2);
if (!buildDirectory) throw new Error('Usage: node native/chain-smoke.mjs <native build directory with DNP3>');
const build = resolve(buildDirectory);
const jobs = [];
const env = { ...process.env, LAB_DISTRIBUTED: '1', LAB_PROCESS_MODEL: '1', LAB_BENCH_PROTECTION_MMS: '1',
  LAB_MMS_PORT: '29701', LAB_BREAKER_MMS_PORT: '29702', LAB_PLANT_MMS_PORT: '29703',
  LAB_IEC104_PORT: '29704', LAB_DNP3_PORT: '29705', LAB_WEB_PORT: '0', PORT: '0',
  LAB_BIND_ADDRESS: '127.0.0.1', LAB_MMS_HOST: '127.0.0.1', LAB_BREAKER_MMS_HOST: '127.0.0.1',
  LAB_PLANT_MMS_HOST: '127.0.0.1', LAB_IEC104_HOST: '127.0.0.1', LAB_DNP3_HOST: '127.0.0.1',
  LAB_WEB_BIND_NAME: '127.0.0.1', LAB_HMI_BIND_ADDRESS: '127.0.0.1' };

function launch(file, args, extra = {}) {
  const child = fork(resolve(root, 'src', file), args, { env: { ...env, ...extra }, silent: true });
  const job = { child, output: '', stopped: once(child, 'exit') };
  job.stopped.catch(() => {});
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { job.output += data; });
  jobs.push(job);
  return job;
}

async function until(test, description, timeout = 9000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await test();
    if (value) return value;
    await delay(50);
  }
  throw new Error(description + '\n' + jobs.map(x => x.output.slice(-2000)).join('\n'));
}
const command = (job, ...lines) => job.child.stdin.write(lines.join('\n') + '\n');

try {
  const roles = ['plant', 'protection', 'breaker', 'gateway', 'control-centre', 'gateway-dnp3', 'control-centre-dnp3'];
  const components = Object.fromEntries(roles.map(role => [role, launch('component-service.mjs', [role, build])]));
  const origins = new Map();
  for (const role of roles) {
    const [, port] = await until(() => components[role].output.match(/web UI ready on 127\.0\.0\.1:(\d+)/), role);
    origins.set(role, 'http://127.0.0.1:' + port);
  }
  const portal = launch('serve.mjs', ['--native', build]);
  const [, origin] = await until(() => portal.output.match(/Native MMS station HMI: (http:\/\/127\.0\.0\.1:\d+)/), 'portal');
  const page = await fetch(origin);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  const stationPage = await page.text();
  assert.match(stationPage, /11 kV single-line/);
  assert.match(stationPage, /Breaker faceplate/);
  assert.match(stationPage, /id="command-dialog"/);
  assert.equal((await fetch(origin + '/components/breaker')).status, 404);
  assert.equal((await fetch(origin + '/api/components/breaker')).status, 404);
  assert.equal(new Set([...origins.values(), origin]).size, roles.length + 1);
  for (const role of roles) {
    const component = origins.get(role);
    const response = await fetch(component);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    const componentPage = await response.text();
    assert.match(componentPage, new RegExp('data-component="' + role + '"'));
    if (['protection', 'breaker'].includes(role)) assert.match(componentPage, /data-ied-view="signals"/);
    for (const filename of ['/station.css', '/components.mjs', '/component-catalog.mjs']) {
      assert.ok((await fetch(component + filename)).ok);
    }
    assert.equal((await fetch(component + '/state', { method: 'POST' })).status, 405);
    assert.equal((await fetch(component + '/components/breaker')).status, 404);
  }
  const state = (role, predicate) => until(async () => {
    const response = await fetch(origins.get(role) + '/state', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const value = await response.json();
    assert.equal(value.component, role);
    return predicate(value.points, value) && value;
  }, role, 20000);
  await Promise.all([
    state('plant', p => p.contactA?.value === true && p.voltage?.value === 11),
    state('protection', p => p.trip?.value === false && p.current?.value === 120),
    state('breaker', p => p.position?.value === 'CLOSED' && p.operationFailure?.value === false),
    ...roles.slice(3).map(role => state(role,
      p => p.position?.value === 'CLOSED' && p.position.quality === 'GOOD' && p.current?.value === 120)),
  ]);
  await until(() => components['control-centre-dnp3'].output.includes('LAN time sync'),
    'DNP3 master did not start LAN time synchronization');
  const yard = await fetch(origins.get('plant') + '/yard/');
  assert.match(await yard.text(), /data-view="walk-room"/);
  assert.equal((await fetch(origins.get('breaker') + '/yard/')).status, 404);
  const hmi = (predicate, label) => until(async () => {
    const result = await (await fetch(origin + '/state')).json();
    return predicate(result.points) && result;
  }, label);
  const isBay = (position, current, trip) => p =>
    p.position?.value === position && p.position.quality === 'GOOD' &&
    p.current?.value === current && p.current.quality === 'GOOD' &&
    p.trip?.value === trip && p.trip.quality === 'GOOD';
  await hmi(isBay('CLOSED', 120, false), 'HMI baseline');
  const operate = async (action, expected) => {
    const response = await fetch(origin + '/control/' + action, {
      method: 'POST', headers: { Origin: origin },
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.result, expected);
  };
  const checkSwitching = async (position, current, contactA, contactB) => {
    const [plant, breaker] = await Promise.all([
      state('plant', p => p.contactA?.value === contactA && p.contactB?.value === contactB &&
        p.current?.value === current),
      state('breaker', p => p.position?.value === position && p.position.quality === 'GOOD'),
      state('protection', p => p.current?.value === current && p.trip?.value === false),
      hmi(isBay(position, current, false), 'HMI ' + position),
      ...roles.slice(3).map(role => state(role, isBay(position, current, false))),
    ]);
    assert.equal(yardTelemetry(plant).position, position);
    await Promise.all(roles.slice(3).map(role => state(role, p => isBay(position, current, false)(p) &&
      Math.abs(p.position.sourceTimeMs - breaker.points.position.sourceTimeMs) <= 1)));
  };
  await operate('open', 'POSITION CONFIRMED');
  await checkSwitching('OPEN', 0, false, true);
  await operate('reset-latch', 'LATCH RESET CONFIRMED');
  await operate('close', 'POSITION CONFIRMED');
  await checkSwitching('CLOSED', 120, true, false);
  console.log('HMI OPEN and CLOSE reached the plant, yard telemetry, IEDs, HMI, IEC 104 and DNP3 with matching position timestamps.');
  command(components.plant, 'fault');
  const fault = yardTelemetry(await state('plant', p => p.fault?.value === true && p.current?.value === 1200));
  assert.deepEqual([fault.position, fault.voltage, fault.current], ['CLOSED', 11, 1200]);
  await Promise.all([hmi(isBay('CLOSED', 1200, true), 'HMI fault pickup'),
    ...roles.slice(3).map(role => state(role, isBay('CLOSED', 1200, true)))]);
  await state('protection', p => p.trip?.value === true);
  command(components.breaker, 'trip');
  await Promise.all(roles.slice(3).map(role => state(role, p => p.position?.value === 'OPEN' && p.current?.value === 0)));
  await state('plant', p => p.contactB?.value === true && p.current?.value === 0);
  const openBreaker = await state('breaker', p => p.position?.value === 'OPEN');
  for (const role of ['control-centre', 'control-centre-dnp3']) {
    await state(role, p => isBay('OPEN', 0, true)(p) &&
      Math.abs(p.position.sourceTimeMs - openBreaker.points.position.sourceTimeMs) <= 1);
  }
  console.log('Both masters received the OPEN event with the BRF01 contact source timestamp.');
  await hmi(isBay('OPEN', 0, true), 'HMI successful trip');
  const open = yardTelemetry(await state('plant', p => p.contactB?.value === true && p.current?.value === 0));
  assert.deepEqual([open.position, open.voltage, open.fault], ['OPEN', 11, true]);
  console.log('One scenario: pickup 1200 A, then OPEN and 0 A at HMI and both masters while source stays 11 kV.');
  command(components.plant, 'clear');
  await until(() => components.protection.output.includes('Process fault cleared'), 'fault cleared');
  command(components.protection, 'reset');
  await state('protection', p => p.trip?.value === false);
  command(components.breaker, 'healthy', 'reset', 'close');
  await state('breaker', p => p.position?.value === 'CLOSED');
  command(components.plant, 'stuck', 'fault');
  await state('protection', p => p.trip?.value === true);
  command(components.breaker, 'trip');
  const failed = await state('breaker', p => p.position?.value === 'CLOSED' && p.operationFailure?.value === true);
  const failureTime = failed.points.operationFailure.sourceTimeMs;
  assert.ok(failureTime > 0);
  const sameFailure = p => isBay('CLOSED', 1200, true)(p) && p.operationFailure?.value === true &&
    p.operationFailure.quality === 'GOOD' && Math.abs(p.operationFailure.sourceTimeMs - failureTime) <= 1;
  await Promise.all([hmi(sameFailure, 'HMI failed trip and timestamp'),
    ...roles.slice(3).map(role => state(role, sameFailure))]);
  console.log('Failed opening: CLOSED, 1200 A and a source-timed operation failure reached HMI and both masters.');
  command(components.plant, 'stall');
  await until(() => components.plant.output.includes('applied stall'), 'stall selected');
  const master104Offset = components['control-centre'].output.length;
  const masterDnp3Offset = components['control-centre-dnp3'].output.length;
  command(components.breaker, 'healthy', 'trip');
  const [changing] = await Promise.all([
    state('plant', p => p.contactA?.value === false && p.contactB?.value === false),
    hmi(p => p.position.value === 'INTERMEDIATE' && p.position.quality === 'GOOD', 'HMI valid intermediate'),
  ]);
  assert.equal(yardTelemetry(changing).position, 'IN TRANSIT');
  await until(() => /movement timeout[\s\S]*feedback UNKNOWN/.test(components.breaker.output), 'stalled BRF01 position');
  await Promise.all([
    state('plant', p => yardTelemetry({ points: p }).position === 'STALLED'),
    hmi(p => p.position.value === null && p.position.quality === 'INVALID', 'HMI stalled position invalid'),
    until(() => /EVENT breaker=INTERMEDIATE quality=0/.test(
      components['control-centre'].output.slice(master104Offset)), 'IEC 104 valid intermediate event'),
    until(() => /\[0\] : INTERMEDIATE\b/.test(
      components['control-centre-dnp3'].output.slice(masterDnp3Offset)), 'DNP3 intermediate event'),
    ...roles.slice(3).map(role =>
      state(role, p => p.position?.value === null && p.position.quality === 'INVALID')),
  ]);
  console.log('Mid-travel stall: yard shows STALLED, HMI first saw valid INTERMEDIATE, then HMI and both masters show invalid position.');
  command(components.plant, 'normal');
  await hmi(isBay('CLOSED', 1200, true), 'HMI recovered after stall');
  command(components.plant, 'contacts-invalid');
  const conflict = yardTelemetry(await state('plant', p => p.contactA?.value === true && p.contactB?.value === true));
  assert.equal(conflict.position, 'INVALID CONTACTS');
  await hmi(p => p.position.value === null && p.position.quality === 'INVALID', 'HMI invalid position');
  await Promise.all(roles.slice(3).map(role =>
    state(role, p => p.position?.value === null && p.position.quality === 'INVALID')));
  command(components.plant, 'normal');
  await hmi(isBay('CLOSED', 1200, true), 'HMI recovered position');
  await Promise.all(roles.slice(3).map(role => state(role, isBay('CLOSED', 1200, true))));
  console.log('Contradictory contacts invalidate position at HMI and both masters, then recover.');
  components.gateway.child.disconnect();
  await components.gateway.stopped;
  for (const role of ['control-centre', 'control-centre-dnp3']) {
    await state(role, (p, value) => role === 'control-centre'
      ? p.position?.quality === 'STALE'
      : p.position?.value === 'CLOSED' && value.link === 'CONNECTED');
  }
  const gatewayRestart = launch('component-service.mjs', ['gateway', build]);
  await until(() => gatewayRestart.output.includes('IEC 104 ready'), 'IEC 104 gateway restarted');
  await state('control-centre', p => isBay('CLOSED', 1200, true)(p));
  console.log('IEC 104 master recovered point data after the gateway restarted.');
  console.log('Distributed monitoring passed through native MMS, IEC 104 and DNP3 with console-injected trip delivery.');
} finally {
  for (const job of jobs) if (job.child.connected) job.child.disconnect();
  await Promise.allSettled(jobs.map(job => job.stopped));
}
