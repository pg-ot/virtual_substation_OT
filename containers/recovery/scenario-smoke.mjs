import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = promisify(execFile);
const project = `ss01-recovery-test-${randomBytes(6).toString('hex')}`;
const script = join(root, 'containers', 'recovery', 'exercise.mjs');
const cli = (...args) => run(process.execPath, [script, ...args], { cwd: root, timeout: 10000 });

async function ports(count) {
  const servers = [];
  try {
    for (let i = 0; i < count; i++) {
      const server = createServer();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      servers.push(server);
    }
    return servers.map(server => server.address().port);
  } finally {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  }
}

function state(port) {
  return new Promise((resolve, reject) => {
    const request = get(`http://127.0.0.1:${port}/state`, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`);
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('State request timed out')), 2000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}

async function until(port, predicate, description) {
  const deadline = Date.now() + 30000;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await state(port);
      if (predicate(last)) return last;
    } catch (error) {
      last = error.message;
    }
    await delay(250);
  }
  throw new Error(`${description}: ${JSON.stringify(last)}`);
}

const goodRemote = value => value.link === 'TRANSFERRING' &&
  ['position', 'trip', 'current'].every(point => value.points?.[point]?.quality === 'GOOD');
const goodStation = value => ['position', 'trip'].every(point => value.points?.[point]?.quality === 'GOOD');

test('isolated IEC 104 configuration fault, verified recovery and remote switching', { timeout: 180000 }, async () => {
  const image = process.env.IEC104_TEST_IMAGE?.trim();
  assert.ok(image, 'Set IEC104_TEST_IMAGE to a freshly built image; see docs/training-resilience-recovery.md.');
  assert.ok(!process.env.LAB_IEC104_CONTROL || process.env.LAB_IEC104_CONTROL === '1',
    'The recovery switching test requires LAB_IEC104_CONTROL=1.');
  const parent = await mkdtemp(join(root, 'outputs', `recovery-scenario-${randomBytes(6).toString('hex')}-`));
  const directory = join(parent, 'exercise');
  const [plant, protection, breaker, gateway, master, hmi] = await ports(6);
  const env = { ...process.env, IEC104_TEST_IMAGE: image, LAB_IEC104_CONTROL: '1',
    LAB_RECOVERY_DIR: directory,
    LAB_PLANT_WEB_PORT: String(plant), LAB_PROTECTION_WEB_PORT: String(protection),
    LAB_BREAKER_WEB_PORT: String(breaker), LAB_GATEWAY_WEB_PORT: String(gateway),
    LAB_CONTROL_CENTRE_WEB_PORT: String(master), LAB_HMI_PORT: String(hmi) };
  const compose = (...args) => run('docker', ['compose', '-p', project, '-f', 'compose.yaml',
    '-f', 'containers/compose.iec104-smoke.yaml', '-f', 'compose.recovery.yaml', ...args],
  { cwd: root, env, timeout: 90000 });
  let created = false;
  try {
    const existing = await run('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]);
    assert.equal(existing.stdout.trim(), '', 'fixture project must be unused');
    await cli('prepare', directory);
    const backup = join(directory, 'approved-backup.json');
    const original = await readFile(backup);
    const trusted = createHash('sha256').update(original).digest('hex');
    created = true;
    await compose('up', '-d', 'control-centre', 'station-hmi');
    await until(master, goodRemote, 'remote baseline');
    await until(hmi, goodStation, 'station baseline');

    await cli('inject', directory);
    await compose('restart', 'control-centre');
    await until(master, value => value.link === 'DISCONNECTED' &&
      value.points?.position?.quality !== 'GOOD', 'remote connection loss');
    await until(hmi, goodStation, 'station indications during remote loss');
    await assert.rejects(cli('restore', directory, backup, '0'.repeat(64)),
      error => /SHA-256 mismatch/.test(error.stderr));
    assert.equal(JSON.parse(await readFile(join(directory, 'active.json'))).iec104Port, 2405);
    await cli('verify', backup, trusted);
    await cli('restore', directory, backup, trusted);
    await compose('restart', 'control-centre');
    const restored = await until(master, goodRemote, 'restored remote monitoring');
    const station = await until(hmi, goodStation, 'station after restore');
    assert.equal(restored.points.position.value, station.points.position.value);
    assert.equal(restored.points.trip.value, station.points.trip.value);

    const centreOrigin = `http://127.0.0.1:${master}`;
    const centrePage = await (await fetch(centreOrigin)).text();
    assert.match(centrePage, /data-remote-action="open" disabled/,
      `Control UI missing from ${image}; rebuild the test image from current source with control enabled.`);
    assert.match(centrePage, /select-before-operate/);
    const remoteControl = async (action, expected) => {
      const response = await fetch(`${centreOrigin}/control/${action}`, {
        method: 'POST', headers: { Origin: centreOrigin }, signal: AbortSignal.timeout(16000),
      });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.result, expected);
    };
    const previousPositionTime = restored.points.position.sourceTimeMs;
    await remoteControl('open', 'POSITION CONFIRMED');
    const opened = await until(master, value => value.points?.position?.quality === 'GOOD' &&
      value.points.position.value === 'OPEN' && value.points.position.sourceTimeMs > previousPositionTime,
    'post-recovery IEC 104 OPEN feedback');
    const permissive = await until(master, value => value.points?.trip?.quality === 'GOOD' &&
      value.points.trip.value === false && value.points.closeInhibited?.quality === 'GOOD',
    'post-recovery clear protection permissive');
    if (permissive.points.closeInhibited.value) {
      const blocked = await fetch(`${centreOrigin}/control/close`, {
        method: 'POST', headers: { Origin: centreOrigin }, signal: AbortSignal.timeout(16000),
      });
      assert.equal(blocked.status, 409);
      assert.equal((await blocked.json()).result, 'REJECTED OR NOT CONFIRMED');
      await until(master, value => value.points?.position?.quality === 'GOOD' &&
        value.points.position.value === 'OPEN', 'interlocked position remains OPEN');
      const hmiOrigin = `http://127.0.0.1:${hmi}`;
      const reset = await fetch(`${hmiOrigin}/control/reset-latch`, {
        method: 'POST', headers: { Origin: hmiOrigin }, signal: AbortSignal.timeout(12000),
      });
      const resetResult = await reset.json();
      assert.equal(reset.status, 200, JSON.stringify(resetResult));
      assert.equal(resetResult.result, 'LATCH RESET CONFIRMED');
      await until(master, value => value.points?.closeInhibited?.quality === 'GOOD' &&
        value.points.closeInhibited.value === false, 'explicit latch reset feedback');
    }
    await remoteControl('close', 'POSITION CONFIRMED');
    const closed = await until(master, value => value.points?.position?.quality === 'GOOD' &&
      value.points.position.value === 'CLOSED' && value.points.position.sourceTimeMs > opened.points.position.sourceTimeMs,
    'post-recovery IEC 104 CLOSE feedback');
    assert.equal(closed.points.position.value, 'CLOSED');
  } finally {
    try {
      if (created) await compose('down', '--volumes', '--remove-orphans');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }
});
