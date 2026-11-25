import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const [build, dnp3] = process.argv.slice(2);
if (!build) throw new Error('Usage: node native/distributed-smoke.mjs <build-directory> [--dnp3]');
const env = { ...process.env, LAB_DISTRIBUTED: '1' };
const executable = name => resolve(build, name + (process.platform === 'win32' ? '.exe' : ''));
const run = (name, ...args) => promisify(execFile)(executable(name), args, { env, timeout: 5000 });
const services = [];

function start(name, ...args) {
  const child = spawn(executable(name), args, { env, stdio: 'pipe' });
  const service = { child, output: '' };
  const finished = once(child, 'close');
  finished.catch(() => {});
  service.finished = finished;
  child.stdin.on('error', error => { service.output += error.message; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8').on('data', chunk => { service.output += chunk; });
  }
  services.push(service);
  return service;
}

async function expect(service, pattern, offset = 0) {
  const { child } = service;
  const deadline = Date.now() + 7000;
  while (!pattern.test(service.output.slice(offset)) && child.exitCode === null &&
         child.signalCode === null && Date.now() < deadline) await delay(25);
  assert.match(service.output.slice(offset), pattern);
}

async function command(service, input, pattern) {
  const offset = service.output.length;
  service.child.stdin.write(input + '\n');
  if (pattern) await expect(service, pattern, offset);
}
const sample = async pattern => assert.match((await run('station-client', 'read')).stdout, pattern);
const closed = /breaker=CLOSED position_quality=0 position_time_ms=[1-9]\d+/;
const open = /breaker=OPEN position_quality=0 position_time_ms=[1-9]\d+/;
const unknown = /breaker=UNKNOWN position_quality=2 position_time_ms=0/;

try {
  const feeder = start('feeder-ied');
  await expect(feeder, /MMS ready/);
  await sample(unknown);
  let breaker = start('breaker-ied', '--bench');
  await expect(breaker, /MMS ready/);
  assert.match((await run('breaker-read')).stdout, /breaker=UNKNOWN quality=2/);
  await command(breaker, 'feedback-closed', /feedback CLOSED/);
  await sample(closed);
  await sample(/position_source=BRF01LD0\/XCBR1\.Pos/);

  const gateway = start('telecontrol104', 'gateway');
  await expect(gateway, /IEC 104 ready/);
  const master104 = start('telecontrol104', 'master', 'watch');
  await expect(master104, /GI breaker=CLOSED quality=0/);
  let masterDnp3;
  if (dnp3 === '--dnp3') {
    const outstation = start('telecontrol-dnp3', 'outstation');
    await expect(outstation, /DNP3 ready/);
    masterDnp3 = start('telecontrol-dnp3', 'master');
    await expect(masterDnp3, /DETERMINED_ON : 129 : /);
  }

  await command(feeder, 'fault', /Applied fault/);
  await sample(/breaker=CLOSED .* trip=1 current_A=1200/);
  await expect(master104, /EVENT breaker=CLOSED quality=0[\s\S]*EVENT trip=1/);
  if (masterDnp3) {
    await expect(masterDnp3, /\[0\] : 1200 : 1 : /);
    assert.doesNotMatch(masterDnp3.output, /DETERMINED_OFF/);
  }

  await command(breaker, 'trip', /feedback OPEN/);
  await command(breaker, 'trip');
  await command(breaker, 'reset', /rejected: reset/);
  assert.equal(breaker.output.match(/operate OPEN/g)?.length, 1);
  await sample(open);
  await expect(master104, /EVENT breaker=OPEN quality=0/);
  if (masterDnp3) await expect(masterDnp3, /DETERMINED_OFF : 65 : [1-9]\d+/);

  await command(feeder, 'clear', /Applied clear/);
  await command(feeder, 'reset', /Applied reset/);
  await command(breaker, 'healthy');
  await command(breaker, 'reset', /rejected: reset/);
  await command(breaker, 'fault-cleared', /confirmed fault clearance/);
  await command(breaker, 'stale');
  await command(breaker, 'reset', /rejected: reset/);
  await command(breaker, 'healthy');
  await command(breaker, 'reset', /latch reset/);
  await sample(open);
  await command(breaker, 'stale');
  await command(breaker, 'close', /rejected: close/);
  await command(breaker, 'healthy');
  await command(breaker, 'close', /feedback CLOSED/);
  await assert.rejects(run('station-client', 'close'), error => /command=REJECTED/.test(error.stdout));

  await command(breaker, 'quit');
  assert.deepEqual(await breaker.finished, [0, null]);
  await sample(unknown);
  await expect(master104, /EVENT breaker=UNKNOWN quality=128/);
  if (masterDnp3) await expect(masterDnp3, /INDETERMINATE/);
  breaker = start('breaker-ied', '--bench');
  await expect(breaker, /MMS ready/);
  await sample(unknown);
  await command(breaker, 'close', /rejected: close/);
  await command(breaker, 'trip');
  await command(breaker, 'feedback-closed', /feedback CLOSED[\s\S]*operate OPEN[\s\S]*feedback OPEN/);
  await sample(open);
  console.log('Distributed breaker bench passed through native ' +
    (masterDnp3 ? 'MMS, IEC 104, and DNP3.' : 'MMS and IEC 104.'));
} finally {
  for (const { child } of services) if (child.exitCode === null && child.signalCode === null) child.kill();
  await Promise.allSettled(services.map(({ finished }) => finished));
}
