import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { operate, state } from './instructor-control.mjs';
import { appendHistory } from './instructor-history.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = promisify(execFile);
const compose = async (...args) => (await cli('docker', ['compose', ...args], { cwd: root, timeout: 15000 })).stdout.trim();
const action = process.argv[2];
const scenarios = new Set(['fault', 'clear', 'stuck', 'stall', 'contacts-invalid', 'normal']);
const normalCurrent = value => Number.isFinite(value) && value >= 117.9 && value <= 122.1;
const gatewayActions = new Map([['gateway-stop', 'stop'], ['gateway-start', 'start']]);
if (!scenarios.has(action) && !gatewayActions.has(action) && action !== 'reset') {
  throw new Error('Usage: node containers/instructor.mjs fault|clear|stuck|stall|contacts-invalid|normal|gateway-stop|gateway-start|reset');
}

async function command(service, text, expected) {
  const id = await compose('ps', '-q', service);
  if (!id) throw new Error(`${service} is not running`);
  const child = spawn('docker', ['attach', '--sig-proxy=false', id], { cwd: root, stdio: 'pipe' });
  let output = '';
  let acknowledged = false;
  const observe = data => {
    const next = output + data;
    if (next.includes(expected)) acknowledged = true;
    output = next.slice(-4096);
  };
  child.stdout.on('data', observe);
  child.stderr.on('data', observe);
  child.stdin.on('error', () => {});
  try {
    await delay(400);
    child.stdin.write(text + '\n');
    await until(() => acknowledged, `${service} did not acknowledge ${text}`);
    console.log(`${new Date().toISOString()} ${service}: ${expected}`);
  } finally {
    child.kill();
  }
}

async function until(probe, description) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    try {
      const value = await probe();
      if (value) return value;
    } catch {}
    await delay(200);
  }
  throw new Error(description);
}

async function endpoint(service, port) {
  const published = await compose('port', service, String(port));
  if (!/^127\.0\.0\.1:\d+$/.test(published)) throw new Error(`Unexpected ${service} address: ${published}`);
  return 'http://' + published;
}

async function run() {
if (gatewayActions.has(action)) {
  await compose(gatewayActions.get(action), 'gateway');
  console.log(`${new Date().toISOString()} IEC 104 gateway: ${gatewayActions.get(action)} requested`);
} else if (action !== 'reset') {
  await command('plant', action, 'Plant applied ' + action);
} else {
  await compose('start', 'gateway');
  const plant = await endpoint('plant', 8090);
  const hmi = await endpoint('station-hmi', 8080);
  await command('plant', 'clear', 'Plant applied clear');
  await command('plant', 'normal', 'Plant applied normal');
  await until(async () => (await state(plant)).points.fault?.value === false, 'Plant fault did not clear');
  await delay(1200);
  await command('protection', 'reset', 'Applied reset');
  await until(async () => {
    const points = (await state(hmi)).points;
    return points.trip?.quality === 'GOOD' && points.trip.value === false && points.position?.quality === 'GOOD';
  }, 'Protection clear or breaker position unavailable');
  const points = (await state(hmi)).points;
  if (points.position.value === 'CLOSED' &&
      (points.closeInhibited?.value === true || points.operationFailure?.value === true)) {
    await operate(hmi, 'open', 'POSITION CONFIRMED');
  }
  const afterOpen = (await state(hmi)).points;
  if (afterOpen.position.value === 'OPEN') {
    if (afterOpen.closeInhibited?.value === true && afterOpen.closeInhibited.quality === 'GOOD') {
      await operate(hmi, 'reset-latch', 'LATCH RESET CONFIRMED');
    } else if (afterOpen.closeInhibited?.value !== false || afterOpen.closeInhibited.quality !== 'GOOD') {
      throw new Error('Breaker latch status is unavailable');
    }
    await operate(hmi, 'close', 'POSITION CONFIRMED');
  }
  await until(async () => {
    const [p, h] = await Promise.all([state(plant), state(hmi)]);
    return p.points.fault?.value === false && p.points.contactA?.value === true &&
      p.points.contactB?.value === false && normalCurrent(p.points.current?.value) &&
      h.points.position?.value === 'CLOSED' && h.points.position.quality === 'GOOD' &&
      h.points.trip?.value === false && h.points.trip.quality === 'GOOD' &&
      h.points.closeInhibited?.value === false && h.points.closeInhibited.quality === 'GOOD' &&
      h.points.operationFailure?.value === false && h.points.operationFailure.quality === 'GOOD';
  }, 'Baseline verification failed');
  for (const service of ['gateway', 'control-centre', 'gateway-dnp3', 'control-centre-dnp3']) {
    const id = await compose('ps', '-q', service);
    if (!id) {
      console.log(`${new Date().toISOString()} ${service}: not running`);
      continue;
    }
    const origin = await endpoint(service, 8090);
    await until(async () => {
      const component = await state(origin);
      return component.service === 'RUNNING' && component.points.position?.value === 'CLOSED' &&
        component.points.position.quality === 'GOOD' && component.points.trip?.value === false &&
        component.points.trip.quality === 'GOOD' && normalCurrent(component.points.current?.value) &&
        component.points.current.quality === 'GOOD';
    }, `${service} did not reach the baseline`);
    console.log(`${new Date().toISOString()} ${service}: baseline verified`);
  }
  console.log(`${new Date().toISOString()} Baseline verified: CLOSED, normal current, fault clear, trip clear`);
}
}

const startedAt = new Date().toISOString();
let result = 'success';
let detail;
try {
  await run();
} catch (error) {
  result = 'failed';
  detail = error.message;
  console.error(detail);
  process.exitCode = 1;
} finally {
  const directory = join(root, 'outputs');
  await mkdir(directory, { recursive: true });
  await appendHistory(join(directory, 'instructor-history.jsonl'), {
    startedAt, finishedAt: new Date().toISOString(), project: process.env.COMPOSE_PROJECT_NAME || 'ss01-bench',
    action, result, ...(detail && { detail }),
  });
}
