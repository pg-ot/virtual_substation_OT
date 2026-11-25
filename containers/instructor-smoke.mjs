import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = promisify(execFile);
const compose = async (...args) => (await cli('docker', ['compose', ...args], { cwd: root, timeout: 15000 })).stdout.trim();
const instructor = async action => (await cli(process.execPath, ['containers/instructor.mjs', action], {
  cwd: root, timeout: 60000, env: process.env,
})).stdout;
const url = async service => 'http://' + await compose('port', service, service === 'station-hmi' ? '8080' : '8090');
const hmi = await url('station-hmi');
const master = await url('control-centre');

async function until(origin, predicate, description) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin + '/state', { signal: AbortSignal.timeout(2000) });
      if (response.ok && predicate(await response.json())) return;
    } catch {}
    await delay(200);
  }
  throw new Error('Timed out: ' + description);
}

try {
  assert.match(await instructor('reset'), /Baseline verified/);
  assert.match(await instructor('fault'), /Plant applied fault/);
  await until(hmi, s => s.points.trip?.value === true && s.points.position?.value === 'OPEN' &&
    s.points.current?.value === 0, 'fault and automatic GOOSE trip');
  assert.match(await instructor('reset'), /Baseline verified/);
  await instructor('gateway-stop');
  await until(master, s => s.points.position?.quality === 'STALE', 'IEC 104 gateway loss');
  assert.match(await instructor('reset'), /control-centre: baseline verified/);
  console.log('Instructor acceptance passed: baseline, automatic fault trip, reset and IEC 104 loss and recovery.');
} finally {
  await instructor('reset').catch(error => {
    console.error('Final reset failed:', error.message);
    process.exitCode = 1;
  });
}
