import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const build = resolve(process.argv[2] ?? 'build-native');
const consoleFile = fileURLToPath(new URL('../src/native-device-console.mjs', import.meta.url));
const launcher = fork(consoleFile, ['protection', '-', build]);
const stopped = once(launcher, 'exit');
const origin = 'http://127.0.0.1:' + (process.env.LAB_CONSOLE_PORT ?? '8211');

async function waitFor(predicate) {
  const deadline = Date.now() + 7000;
  while (launcher.exitCode === null && Date.now() < deadline) {
    try {
      const response = await fetch(origin + '/state', { signal: AbortSignal.timeout(800) });
      const state = await response.json();
      if (response.ok && predicate(state)) return state;
    } catch (error) {
      if (error.cause?.code === 'EACCES') throw error;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error('Timed out waiting for protection console state');
}

function action(name, requestOrigin = origin) {
  return fetch(origin + '/instructor/' + name, { method: 'POST', headers: { Origin: requestOrigin } });
}

try {
  const initial = await waitFor(state => state.quality === 'LIVE' && state.sample?.position === 'CLOSED');
  assert.equal(initial.sample.currentA, 120);
  assert.equal((await action('fault', 'http://127.0.0.1:3000')).status, 403);
  assert.equal((await action('fault')).status, 202);
  const tripped = await waitFor(state => state.sample?.position === 'OPEN' && state.sample.trip);
  assert.equal(tripped.sample.currentA, 0);
  assert.ok(tripped.events.some(item => item.message === 'Applied fault'));

  assert.equal((await action('clear')).status, 202);
  assert.equal((await action('reset')).status, 202);
  const reset = await waitFor(state => state.sample?.trip === false);
  assert.equal(reset.sample.position, 'OPEN');
  const client = join(build, process.platform === 'win32' ? 'station-client.exe' : 'station-client');
  await promisify(execFile)(client, ['close'], { timeout: 4000 });
  await waitFor(state => state.sample?.position === 'CLOSED');
  console.log('Native protection console passed: live MMS, fault, latch reset, and separate MMS close.');
} finally {
  if (launcher.connected) launcher.disconnect();
  await stopped;
}
