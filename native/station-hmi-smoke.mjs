import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const build = resolve(process.argv[2] ?? 'build-native');
const suffix = process.platform === 'win32' ? '.exe' : '';
const env = { ...process.env, LAB_DISTRIBUTED: '1', PORT: '0' };
const children = [];

function track(child) {
  const entry = { child, output: '', finished: once(child, 'exit') };
  entry.finished.catch(() => {});
  child.stdout.setEncoding('utf8').on('data', chunk => { entry.output += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { entry.output += chunk; });
  children.push(entry);
  return entry;
}

function device(name, ...args) {
  return track(spawn(resolve(build, name + suffix), args, { env, stdio: 'pipe' }));
}

async function until(check, description) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(50);
  }
  throw new Error('Timed out waiting for ' + description + '\n' +
    children.map(({ output }) => output).join('\n'));
}

try {
  const feeder = device('feeder-ied');
  const breaker = device('breaker-ied', '--bench');
  await until(() => /MMS ready/.test(feeder.output) && /MMS ready/.test(breaker.output), 'native IEDs');
  const launcher = fileURLToPath(new URL('../src/serve.mjs', import.meta.url));
  const hmi = track(fork(launcher, ['--native', build], { env, silent: true }));
  const match = await until(() => hmi.output.match(/Native MMS station HMI: (http:\/\/127\.0\.0\.1:\d+)/), 'HMI URL');
  const url = match[1];
  const page = await (await fetch(url)).text();
  assert.match(page, /MMS MONITORING · READ ONLY/);
  assert.doesNotMatch(page, /data-action/);
  assert.equal((await fetch(url + '/state', { method: 'POST' })).status, 405);
  for (const route of ['/native-station.mjs', '/single-line.mjs', '/station.css']) {
    assert.equal((await fetch(url + route, { method: 'HEAD' })).status, 200);
  }

  const station = predicate => until(async () => {
    const response = await fetch(url + '/state', { signal: AbortSignal.timeout(1000) });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const snapshot = await response.json();
    return predicate(snapshot.points) ? snapshot : null;
  }, 'MMS station indications');

  await station(p => p.position.value === null && p.position.quality === 'INVALID' && p.trip.value === false);
  breaker.child.stdin.write('feedback-closed\n');
  const normal = await station(p => p.position.value === 'CLOSED' && p.current.value === 120);
  assert.equal(normal.points.position.source, 'BRF01LD0/XCBR1.Pos');
  assert.equal(normal.points.position.quality, 'GOOD');
  assert.ok(normal.points.position.sourceTimeMs > 0);

  feeder.child.stdin.write('fault\n');
  const separated = await station(p => p.position.value === 'CLOSED' && p.trip.value === true);
  assert.equal(separated.points.trip.source, 'PRF01LD0/PTRC1.Tr');
  assert.equal(separated.points.position.sourceTimeMs, normal.points.position.sourceTimeMs);
  assert.ok(separated.events.some(e => e.point === 'trip' && e.value === true));

  breaker.child.stdin.write('trip\n');
  const opened = await station(p => p.position.value === 'OPEN' && p.trip.value === true);
  assert.ok(opened.events.some(e => e.point === 'position' && e.value === 'OPEN'));
  breaker.child.stdin.write('quit\n');
  await breaker.finished;
  const lost = await station(p => p.position.value === null && p.position.quality === 'INVALID' && p.trip.value === true);
  assert.equal(lost.points.position.sourceTimeMs, null);
  assert.equal(lost.points.trip.quality, 'GOOD');

  const restarted = device('breaker-ied', '--bench');
  await until(() => /MMS ready/.test(restarted.output), 'restarted breaker');
  restarted.child.stdin.write('feedback-open\n');
  await station(p => p.position.value === 'OPEN' && p.position.quality === 'GOOD');
  feeder.child.stdin.write('quit\n');
  await feeder.finished;
  await station(p => p.position.value === 'OPEN' && p.trip.value === null && p.current.value === null);
  console.log('Native station HMI passed: read-only, independent indications, transition history, loss and recovery.');
} finally {
  for (const { child } of children) {
    if (child.connected) child.disconnect();
    else if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  await Promise.allSettled(children.map(entry => entry.finished));
}
