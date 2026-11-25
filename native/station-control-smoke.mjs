import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const build = resolve(process.argv[2] ?? 'build-native');
const suffix = process.platform === 'win32' ? '.exe' : '';
const env = {
  ...process.env, LAB_DISTRIBUTED: '1', LAB_PROCESS_MODEL: '1', LAB_BENCH_PROTECTION_MMS: '1', PORT: '0',
  LAB_BIND_ADDRESS: '127.0.0.1', LAB_HMI_BIND_ADDRESS: '127.0.0.1',
  LAB_MMS_HOST: '127.0.0.1', LAB_BREAKER_MMS_HOST: '127.0.0.1', LAB_PLANT_MMS_HOST: '127.0.0.1',
  LAB_MMS_PORT: '29681', LAB_BREAKER_MMS_PORT: '29682', LAB_PLANT_MMS_PORT: '29683',
};
const jobs = [];

function track(child) {
  const job = { child, output: '', stopped: once(child, 'exit') };
  job.stopped.catch(() => {});
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { job.output += chunk; });
  jobs.push(job);
  return job;
}

function device(name, ...args) {
  return track(spawn(resolve(build, name + suffix), args, { env, stdio: 'pipe' }));
}

async function until(check, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(50);
  }
  throw new Error(label + '\n' + jobs.map(job => job.output).join('\n'));
}

const command = (job, lines) => job.child.stdin.write(lines + '\n');

try {
  const plant = device('plant-ied');
  const protection = device('feeder-ied');
  const breaker = device('breaker-ied', '--bench');
  await until(() => [plant, protection, breaker].every(job => /MMS ready/.test(job.output)), 'MMS startup');
  const launcher = fileURLToPath(new URL('../src/serve.mjs', import.meta.url));
  const station = track(fork(launcher, ['--native', build], { env, silent: true }));
  const [, origin] = await until(() => station.output.match(/Native MMS station HMI: (http:\/\/127\.0\.0\.1:\d+)/), 'HMI startup');
  const page = await (await fetch(origin)).text();
  assert.match(page, /MMS MONITORING AND CONTROL/);
  assert.match(page, /data-action="open"/);
  assert.match(page, /data-action="close"/);
  assert.match(page, /data-action="reset-latch"/);
  assert.match(page, /id="confirm-command"/);
  assert.equal((await fetch(origin + '/station-mimic.mjs')).status, 200);
  assert.equal((await fetch(origin + '/industrial.css')).status, 200);

  const state = async () => (await (await fetch(origin + '/state')).json()).points;
  const position = target => until(async () => {
    const points = await state();
    return points.position.quality === 'GOOD' && points.position.value === target && points;
  }, 'Position ' + target);
  const operate = (action, source = origin) => fetch(origin + '/control/' + action, {
    method: 'POST', headers: { Origin: source },
  });
  const expectResult = async (action, status, result) => {
    const response = await operate(action);
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.result, result);
    return body;
  };

  await position('CLOSED');
  assert.equal((await operate('open', 'http://127.0.0.1:12345')).status, 403);
  assert.equal((await fetch(origin + '/control/open')).status, 404);
  assert.equal((await expectResult('open', 200, 'POSITION CONFIRMED')).sourceTimeMs,
    (await position('OPEN')).position.sourceTimeMs);
  await expectResult('close', 409, 'REJECTED');
  await position('OPEN');

  command(plant, 'fault');
  await until(() => protection.output.includes('Process fault active'), 'Process fault propagated');
  await expectResult('reset-latch', 409, 'REJECTED');
  command(plant, 'clear');
  await until(() => protection.output.includes('Process fault cleared'), 'Process clearance propagated');
  command(protection, 'quit');
  await protection.stopped;
  await until(async () => (await state()).trip.quality === 'INVALID', 'Lost protection indication');
  await until(() => breaker.output.includes('MMS protection permissive blocked'), 'Breaker clear permissive dropped');
  await expectResult('reset-latch', 409, 'REJECTED');
  const restartOffset = breaker.output.length;
  const restartedProtection = device('feeder-ied');
  await until(() => restartedProtection.output.includes('MMS ready'), 'Protection restart');
  await until(async () => (await state()).trip.quality === 'GOOD', 'Restored protection indication');
  await until(() => breaker.output.slice(restartOffset).includes('MMS protection permissive clear'),
    'Breaker clear permissive restored');
  await expectResult('reset-latch', 200, 'LATCH RESET CONFIRMED');
  assert.equal((await position('OPEN')).closeInhibited.value, false);
  await expectResult('close', 200, 'POSITION CONFIRMED');
  await position('CLOSED');

  command(plant, 'stuck');
  await until(() => plant.output.includes('Plant applied stuck'), 'Stuck mechanism selected');
  await expectResult('open', 504, 'POSITION NOT CONFIRMED');
  assert.equal((await position('CLOSED')).operationFailure.value, true);
  console.log('Station HMI control passed: confirmed OPEN, latch reset, and CLOSE without console permissives. Active fault, missing protection, and latch interlocks held.');
} finally {
  for (const { child } of jobs) {
    if (child.connected) child.disconnect();
    else if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  await Promise.allSettled(jobs.map(job => job.stopped));
}
