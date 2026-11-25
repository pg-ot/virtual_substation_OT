import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { state } from './instructor-control.mjs';

const project = process.env.COMPOSE_PROJECT_NAME;
assert.ok(project && /^ss01-iec104-control-[a-z0-9-]+$/.test(project),
  'Use a uniquely named ss01-iec104-control-* isolated Compose project.');
assert.notEqual(process.env.LAB_IEC104_CONTROL, '0', 'Run this test with the default control-enabled profile.');

const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const compose = async (...args) => (await exec('docker', ['compose', ...args], {
  cwd: root, env: process.env, timeout: 20000,
})).stdout.trim();
const instructor = async action => (await exec(process.execPath, ['containers/instructor.mjs', action], {
  cwd: root, env: process.env, timeout: 60000,
})).stdout;
const endpoint = async (service, port = 8090) => {
  const address = await compose('port', service, String(port));
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  return 'http://' + address;
};
const centre = await endpoint('control-centre');
const hmi = await endpoint('station-hmi', 8080);

async function waitFor(origin, description, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await state(origin);
      if (predicate(last)) return last;
    } catch {}
    await delay(200);
  }
  throw new Error(`${description}: ${JSON.stringify(last)}`);
}

async function control(action, expectedStatus, expectedResult) {
  const response = await fetch(centre + '/control/' + action, {
    method: 'POST', headers: { Origin: centre }, signal: AbortSignal.timeout(16000),
  });
  const result = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(result));
  assert.equal(result.result, expectedResult);
  return result;
}

try {
  await instructor('reset');
  const page = await (await fetch(centre)).text();
  assert.match(page, /data-remote-action="open" disabled/);
  assert.match(page, /data-remote-action="close" disabled/);
  assert.match(page, /select-before-operate/);
  const client = await (await fetch(centre + '/components.mjs')).text();
  assert.match(client, /window\.confirm/);
  const controls = await (await fetch(centre + '/iec104-controls.mjs')).text();
  assert.match(controls, /position\?\.quality !== 'GOOD'/);

  const baseline = await waitFor(centre, 'IEC 104 baseline', sample =>
    sample.link === 'TRANSFERRING' && sample.points.position?.quality === 'GOOD' &&
    sample.points.position.value === 'CLOSED' && sample.points.trip?.quality === 'GOOD');
  const rejectedOrigin = await fetch(centre + '/control/open', {
    method: 'POST', headers: { Origin: 'http://example.invalid' },
  });
  assert.equal(rejectedOrigin.status, 403);

  const opened = await control('open', 200, 'POSITION CONFIRMED');
  assert.ok(opened.action === 'open');
  const openFeedback = await waitFor(centre, 'independent OPEN position feedback', sample =>
    sample.points.position?.quality === 'GOOD' && sample.points.position.value === 'OPEN' &&
    sample.points.position.sourceTimeMs > baseline.points.position.sourceTimeMs);
  assert.ok(openFeedback.points.position.observedAt > 0);

  await control('close', 200, 'POSITION CONFIRMED');
  const closedFeedback = await waitFor(centre, 'independent CLOSED position feedback', sample =>
    sample.points.position?.quality === 'GOOD' && sample.points.position.value === 'CLOSED' &&
    sample.points.position.sourceTimeMs > openFeedback.points.position.sourceTimeMs);

  await instructor('fault');
  await waitFor(hmi, 'protection trip and automatic opening', sample =>
    sample.points.trip?.quality === 'GOOD' && sample.points.trip.value === true &&
    sample.points.position?.quality === 'GOOD' && sample.points.position.value === 'OPEN' &&
    sample.points.closeInhibited?.quality === 'GOOD' && sample.points.closeInhibited.value === true);
  await control('close', 409, 'REJECTED OR NOT CONFIRMED');
  const stillOpen = await waitFor(centre, 'interlocked breaker remains OPEN', sample =>
    sample.points.position?.quality === 'GOOD' && sample.points.position.value === 'OPEN' &&
    sample.points.trip?.value === true && sample.points.closeInhibited?.value === true);
  assert.ok(stillOpen.points.position.sourceTimeMs > closedFeedback.points.position.sourceTimeMs);
  console.log('PASS IEC 104 default supervised switching: same-origin select/execute, independent feedback, protection interlock and foreign-origin rejection.');
} finally {
  await instructor('reset').catch(error => console.error('Isolated project reset failed:', error.message));
}
