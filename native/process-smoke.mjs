import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const build = resolve(process.argv[2] ?? 'build-native');
const env = { ...process.env, LAB_DISTRIBUTED: '1', LAB_PROCESS_MODEL: '1' };
const services = [];
const executable = name => resolve(build, name + (process.platform === 'win32' ? '.exe' : ''));
const execute = promisify(execFile);

function start(name, ...args) {
  const child = spawn(executable(name), args, { env, stdio: 'pipe' });
  const service = { child, output: '', done: once(child, 'exit') };
  service.done.catch(() => {});
  child.stdin.on('error', error => { service.output += error.message; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8').on('data', chunk => { service.output += chunk; });
  }
  services.push(service);
  return service;
}

async function until(read, pattern) {
  const deadline = Date.now() + 6500;
  let output;
  do {
    output = await read();
    if (pattern.test(output)) return output;
    await delay(25);
  } while (Date.now() < deadline);
  assert.match(output, pattern, services.map(service => service.output).join('\n'));
}

function command(service, input, pattern) {
  const offset = service.output.length;
  service.child.stdin.write(input + '\n');
  if (pattern) return until(() => service.output.slice(offset), pattern);
}

const read = (name, pattern) => until(async () => {
  try { return (await execute(executable(name), [], { env, timeout: 2500 })).stdout; }
  catch (error) { return error.stderr ?? error.message; }
}, pattern);
const station = pattern => read('station-client', pattern);
const device = pattern => read('breaker-read', pattern);
const plantState = pattern => read('plant-read', pattern);

try {
  const plant = start('plant-ied');
  const feeder = start('feeder-ied');
  const breaker = start('breaker-ied', '--bench');
  for (const service of services) await until(() => service.output, /MMS ready/);
  await plantState(/52a=1 52b=0 fault=0 source_kV=11 feeder_A=120/);
  await station(/breaker=CLOSED .* trip=0 current_A=120 /);
  await command(plant, 'fault', /applied fault/);
  await station(/breaker=CLOSED .* trip=1 current_A=1200 /);
  const successOffset = breaker.output.length;
  await command(breaker, 'trip', /feedback OPEN/);
  assert.match(breaker.output.slice(successOffset), /operate OPEN[\s\S]*feedback INTERMEDIATE[\s\S]*feedback OPEN/);
  assert.equal((plant.output.match(/Plant accepted OPEN/g) ?? []).length, 1);
  await device(/breaker=OPEN quality=0[^\r\n]*[\r\n]+operation_failure=0/);
  await station(/breaker=OPEN .* trip=1 current_A=0 /);
  await plantState(/52a=0 52b=1 fault=1 source_kV=11 feeder_A=0/);
  await command(breaker, 'healthy');
  await command(breaker, 'reset', /rejected: reset/);

  const clearedOffset = feeder.output.length;
  await command(plant, 'clear', /applied clear/);
  await until(() => feeder.output.slice(clearedOffset), /Process fault cleared/);
  await command(feeder, 'reset', /Applied reset/);
  await command(breaker, 'healthy');
  await command(breaker, 'reset', /latch reset/);
  const motionOffset = plant.output.length;
  await command(breaker, 'close', /close queued/);
  await until(() => plant.output.slice(motionOffset), /accepted CLOSE/);
  await command(breaker, 'trip', /close superseded by trip/);
  await until(() => plant.output.slice(motionOffset), /Plant close superseded by OPEN/);
  await device(/breaker=OPEN quality=0/);
  assert.doesNotMatch(plant.output.slice(motionOffset), /Plant contacts CLOSED/);

  await command(breaker, 'healthy');
  await command(breaker, 'reset', /latch reset/);
  await command(breaker, 'close', /feedback CLOSED/);
  await command(plant, 'stuck', /applied stuck/);
  await command(plant, 'fault', /applied fault/);
  await station(/breaker=CLOSED .* trip=1 current_A=1200 /);
  const stuckOffset = plant.output.length;
  await command(breaker, 'trip', /operate OPEN/);
  await command(breaker, 'trip');
  await until(() => breaker.output, /operation failed: movement timeout/);
  assert.equal((plant.output.slice(stuckOffset).match(/Plant accepted OPEN/g) ?? []).length, 1);
  await device(/breaker=CLOSED quality=0[^\r\n]*[\r\n]+operation_failure=1/);
  await plantState(/52a=1 52b=0 fault=1 source_kV=11 feeder_A=1200/);

  await command(plant, 'stall', /applied stall/);
  await command(breaker, 'healthy');
  const stalledOffset = breaker.output.length;
  await command(breaker, 'trip', /feedback INTERMEDIATE/);
  await plantState(/52a=0 52b=0/);
  await until(() => breaker.output.slice(stalledOffset), /movement timeout[\s\S]*feedback UNKNOWN/);
  await device(/breaker=UNKNOWN quality=2[^\r\n]*[\r\n]+operation_failure=1/);

  await command(plant, 'normal', /applied normal/);
  await device(/breaker=CLOSED quality=0/);
  await command(plant, 'contacts-invalid', /applied contacts-invalid/);
  await plantState(/52a=1 52b=1/);
  await device(/breaker=UNKNOWN quality=2/);
  await command(plant, 'quit');
  await plant.done;
  await device(/breaker=UNKNOWN quality=2 source_ms=0/);
  await station(/breaker=UNKNOWN .* trip=1 current_A=0 trip_quality=2 current_quality=2/);
  console.log('Process MMS passed: normal trip, sustained fault, trip superseding close, no travel, mid-travel stall, contradictory contacts, and feedback loss.');
} finally {
  for (const { child } of services) if (child.exitCode === null && child.signalCode === null) child.kill();
  await Promise.allSettled(services.map(service => service.done));
}
