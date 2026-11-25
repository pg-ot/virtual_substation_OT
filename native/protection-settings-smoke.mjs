import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const build = resolve(process.argv[2] ?? 'build-native');
const executable = name => resolve(build, name + (process.platform === 'win32' ? '.exe' : ''));
const exec = promisify(execFile);
const env = { ...process.env, LAB_DISTRIBUTED: '1', LAB_PROCESS_MODEL: '1',
  LAB_BIND_ADDRESS: '127.0.0.1', LAB_MMS_HOST: '127.0.0.1', LAB_PLANT_MMS_HOST: '127.0.0.1',
  LAB_MMS_PORT: '29741', LAB_PLANT_MMS_PORT: '29742' };
const services = [];
const plantFaultAmps = 1200;
let lastSnapshotError = '';

function start(name, extra = {}) {
  const child = spawn(executable(name), [], { env: { ...env, ...extra }, stdio: 'pipe' });
  const service = { child, output: '', done: once(child, 'exit') };
  service.done.catch(() => {});
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8').on('data', chunk => { service.output += chunk; });
  }
  child.stdin.on('error', error => { service.output += error.message; });
  services.push(service);
  return service;
}

async function until(description, probe) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await delay(25);
  }
  throw new Error(description + '\n' + lastSnapshotError + '\n' +
    services.map(service => service.output).join('\n'));
}

async function command(service, input) {
  const offset = service.output.length;
  service.child.stdin.write(input + '\n');
  await until('Command not acknowledged: ' + input,
    () => service.output.slice(offset).includes('Plant applied ' + input));
}

async function snapshot() {
  try {
    const { stdout } = await exec(executable('station-client'), ['protection-read'], { env, timeout: 1000 });
    return JSON.parse(stdout);
  } catch (error) {
    lastSnapshotError = `Last protection read failed: ${error.message}`;
    return null;
  }
}

async function waitCurrent(predicate) {
  return until('Expected protection current not received', async () => {
    const state = await snapshot();
    return state?.current?.quality === 0 && state.trip?.quality === 0 &&
      predicate(state.current.value) ? state : null;
  });
}

try {
  await assert.rejects(exec(executable('feeder-ied'), [], {
    env: { ...env, LAB_PROTECTION_PICKUP_A: 'bad' }, timeout: 3000,
  }), error => error.code === 2 && /LAB_PROTECTION_PICKUP_A/.test(error.stderr));
  const plant = start('plant-ied');
  const highPickup = start('feeder-ied', {
    LAB_PROTECTION_PICKUP_A: String(plantFaultAmps + 1), LAB_PROTECTION_DELAY_MS: '0',
  });
  await until('IEDs not ready', () => plant.output.includes('MMS ready') && highPickup.output.includes('MMS ready'));
  await waitCurrent(value => value < 250);
  await command(plant, 'fault');
  await waitCurrent(value => value === plantFaultAmps);
  await delay(300);
  assert.equal((await waitCurrent(value => value === plantFaultAmps)).trip.value, false,
    'Current below the configured pickup must not trip');
  await command(plant, 'clear');
  await waitCurrent(value => value < 250);
  highPickup.child.kill();
  await highPickup.done;
  const feeder = start('feeder-ied', {
    LAB_PROTECTION_PICKUP_A: String(plantFaultAmps), LAB_PROTECTION_DELAY_MS: '1000',
  });
  await until('Feeder not ready', () => feeder.output.includes('MMS ready'));
  await waitCurrent(value => value < 250);
  await command(plant, 'fault');
  let state = await waitCurrent(value => value === plantFaultAmps);
  assert.equal(state.trip.value, false, 'Trip must not assert on the first observed high current');
  await delay(200);
  state = await waitCurrent(value => value === plantFaultAmps);
  assert.equal(state.trip.value, false, 'Trip must not assert before the configured delay');
  await command(plant, 'clear');
  await waitCurrent(value => value < 250);
  await delay(1000);
  assert.equal((await waitCurrent(value => value < 250)).trip.value, false,
    'The cleared fault must not trip at the old deadline');
  await command(plant, 'fault');
  state = await waitCurrent(value => value === plantFaultAmps);
  assert.equal(state.trip.value, false, 'The cleared pickup must restart the delay');
  await until('Delayed trip not asserted', async () => (await snapshot())?.trip?.value === true);
  console.log('Protection settings smoke passed: invalid startup, one amp below pickup, exact pickup, and delay restart.');
} finally {
  for (const { child } of services) if (child.exitCode === null && child.signalCode === null) child.kill();
  await Promise.allSettled(services.map(service => service.done));
}
