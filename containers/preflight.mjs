import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const compose = async (...args) => (await exec('docker', ['compose', ...args], { cwd: root, timeout: 12000 })).stdout.trim();
const docker = async (...args) => (await exec('docker', args, { cwd: root, timeout: 12000 })).stdout.trim();
let failures = 0;

async function check(name, operation) {
  try {
    const detail = await operation();
    console.log(`PASS ${name}${detail ? ': ' + detail : ''}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function origin(service, port) {
  const published = await compose('port', service, String(port));
  if (!/^127\.0\.0\.1:\d+$/.test(published)) throw new Error(`Unexpected address ${published}`);
  return 'http://' + published;
}

async function readState(service, port) {
  const url = await origin(service, port);
  const response = await fetch(url + '/state', { signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function expectPoint(points, name, value) {
  const point = points[name];
  if (point?.quality !== 'GOOD' || point.value !== value) {
    throw new Error(`${name} expected ${value} with GOOD quality, received ${JSON.stringify(point)}`);
  }
}

function expectRange(points, name, minimum, maximum) {
  const point = points[name];
  if (point?.quality !== 'GOOD' || !Number.isFinite(point.value) || point.value < minimum || point.value > maximum) {
    throw new Error(`${name} expected ${minimum}–${maximum} with GOOD quality, received ${JSON.stringify(point)}`);
  }
}

await check('SIMF01 process', async () => {
  const { points } = await readState('plant', 8090);
  for (const [name, value] of [['contactA', true], ['contactB', false], ['fault', false]]) {
    expectPoint(points, name, value);
  }
  expectRange(points, 'voltage', 10.95, 11.05);
  expectRange(points, 'current', 117.9, 122.1);
  return 'CLOSED contacts, normal voltage and current, fault clear';
});

await check('PRF01 protection', async () => {
  const { points } = await readState('protection', 8090);
  expectPoint(points, 'trip', false);
  expectRange(points, 'current', 117.9, 122.1);
});

await check('BRF01 and GOOSE', async () => {
  const { points } = await readState('breaker', 8090);
  expectPoint(points, 'position', 'CLOSED');
  expectPoint(points, 'operationFailure', false);
  const model = await readFile(new URL('../native/feeder.cid', import.meta.url), 'utf8');
  const control = /<GSEControl\s+name="Protection"[^>]*\bdatSet="([^"]+)"[^>]*\bconfRev="(\d+)"/.exec(model);
  if (!control) throw new Error('Protection GOOSE control block is missing from local SCL');
  const [, dataset, revision] = control;
  const advertised = await compose('exec', '-T', 'protection', 'station-client', 'goose-config');
  if (!advertised.includes(`$${dataset} confRev=${revision} `))
    throw new Error(`PRF01 GOOSE configuration differs from local SCL: ${advertised}`);
  const recent = await compose('logs', '--since', '8s', '--no-color', '--no-log-prefix', 'breaker');
  const live = new RegExp(`GOOSE LIVE [^\\r\\n]*confRev=${revision} [^\\r\\n]*trip=0`);
  if (!live.test(recent)) throw new Error(`No recent clear GOOSE message at revision ${revision}`);
  return `CLOSED, no operation failure, live clear GOOSE revision ${revision}`;
});

await check('Station HMI', async () => {
  const { points } = await readState('station-hmi', 8080);
  for (const [name, value] of [['position', 'CLOSED'], ['trip', false],
    ['operationFailure', false], ['closeInhibited', false]]) expectPoint(points, name, value);
  expectRange(points, 'current', 117.9, 122.1);
});

for (const service of ['gateway', 'control-centre', 'gateway-dnp3', 'control-centre-dnp3']) {
  const running = await compose('ps', '-q', service);
  if (!running && service.includes('dnp3')) {
    console.log(`SKIP ${service}: profile not running`);
    continue;
  }
  await check(service, async () => {
    if (!running) throw new Error('Service is not running');
    const component = await readState(service, 8090);
    if (component.service !== 'RUNNING') throw new Error(`Service ${component.service}`);
    for (const [name, value] of [['position', 'CLOSED'], ['trip', false], ['closeInhibited', false]]) {
      expectPoint(component.points, name, value);
    }
    expectRange(component.points, 'current', 117.9, 122.1);
  });
}

await check('Running image identity', async () => {
  const ids = (await compose('ps', '-q')).split(/\s+/).filter(Boolean);
  if (!ids.length) throw new Error('No running Compose services');
  for (const id of ids) {
    const details = JSON.parse(await docker('inspect', id));
    const container = details[0];
    const reference = container.Config.Image;
    const imageId = await docker('image', 'inspect', reference, '--format', '{{.Id}}');
    if (container.Image !== imageId) {
      throw new Error(`${container.Name.replace(/^\//, '')} uses an older image than ${reference}`);
    }
  }
  return `${ids.length} running service images match their local tags`;
});

await check('3D yard assets', async () => {
  const base = await origin('plant', 8090);
  for (const path of ['/yard/', '/yard/yard.wasm']) {
    const response = await fetch(base + path, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  }
  return 'HTTP assets available';
});

if (failures) {
  console.error(`Preflight failed: ${failures} check(s).`);
  process.exitCode = 1;
} else console.log('Preflight passed for the running profiles.');
