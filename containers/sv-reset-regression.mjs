import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const docker = async (...args) => (await exec('docker', args, { cwd: root, timeout: 15000 })).stdout.trim();
const compose = (...args) => docker('compose', '-f', 'compose.yaml', '-f', 'compose.sv.yaml', ...args);
const project = process.env.COMPOSE_PROJECT_NAME;
if (!project) throw new Error('Set COMPOSE_PROJECT_NAME to the isolated SV test project.');

const protection = await compose('ps', '-q', 'protection');
const mergingUnit = await compose('ps', '-q', 'merging-unit');
const protectionPort = await compose('port', 'protection', '8090');
const plantPort = await compose('port', 'plant', '8090');
assert.ok(protection && mergingUnit, 'Start the SV profile before this test.');
const protectionEnv = JSON.parse(await docker('inspect', '--format', '{{json .Config.Env}}', protection));
const rateSetting = protectionEnv.find(value => value.startsWith('LAB_SV_SAMPLES_PER_SECOND='));
const sampleRate = rateSetting ? rateSetting.slice('LAB_SV_SAMPLES_PER_SECOND='.length) : '4000';
assert.ok(['400', '4000'].includes(sampleRate), `Unsupported SV sample rate: ${sampleRate}`);
assert.match(protectionPort, /^127\.0\.0\.1:\d+$/);
assert.match(plantPort, /^127\.0\.0\.1:\d+$/);
const protectionUrl = 'http://' + protectionPort + '/state';
const plantUrl = 'http://' + plantPort + '/state';
const fixtureName = project + '-sv-reset-fixture';
const attached = spawn('docker', ['attach', '--sig-proxy=false', protection], { cwd: root, stdio: 'pipe' });
let output = '';
attached.stdout.on('data', chunk => { output += chunk; });
attached.stderr.on('data', chunk => { output += chunk; });
attached.stdin.on('error', () => {});
let fixture;
let failure;

async function until(description, probe) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if (await probe()) return; } catch {}
    await delay(100);
  }
  throw new Error('Timed out waiting for ' + description + '\n' + output);
}

try {
  const plant = await (await fetch(plantUrl)).json();
  assert.equal(plant.points.fault.value, false, 'Start with the plant fault clear.');
  await docker('stop', mergingUnit);
  fixture = spawn('docker', ['run', '--rm', '--name', fixtureName,
    '--network', project + '_process', '--cap-add', 'NET_RAW',
    '-v', root + ':/repo:ro', '--entrypoint', 'python3', 'ss01-kali:dev',
    '/repo/containers/sv-overcurrent-fixture.py', 'eth0', '30', sampleRate], { cwd: root, stdio: 'pipe' });
  let fixtureError = '';
  fixture.stderr.on('data', chunk => { fixtureError += chunk; });
  await until('SV overcurrent and asserted trip', async () => {
    if (fixture.exitCode !== null) throw new Error('SV fixture exited: ' + fixtureError);
    const state = await (await fetch(protectionUrl)).json();
    return state.points.current?.quality === 'GOOD' && state.points.current.value > 500 &&
      state.points.trip?.value === true;
  });
  assert.equal((await (await fetch(plantUrl)).json()).points.fault.value, false);
  await delay(400);
  const offset = output.length;
  attached.stdin.write('reset\n');
  await until('protection reset response', () => /Rejected\.|Applied reset/.test(output.slice(offset)));
  assert.match(output.slice(offset), /Rejected\./, 'Reset was accepted while measured overcurrent remained present.');
  assert.equal((await (await fetch(protectionUrl)).json()).points.trip.value, true);
  console.log('SV reset regression passed: trip remained asserted with fault clear and overcurrent present.');
} catch (error) {
  failure = error;
} finally {
  attached.kill();
  if (fixture) await docker('stop', fixtureName).catch(() => {});
  await docker('start', mergingUnit).catch(() => {});
  try {
    const result = await exec(process.execPath, ['containers/instructor.mjs', 'reset'], {
      cwd: root, env: process.env, timeout: 60000,
    });
    process.stdout.write(result.stdout);
  } catch (error) {
    if (!failure) throw error;
    console.error('Cleanup reset failed:', error.message);
  }
}
if (failure) throw failure;
