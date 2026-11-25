import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const base = process.argv[2];
assert.match(base ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
const exec = promisify(execFile);
async function request(path, body, requestOrigin = base) {
  const response = await fetch(base + path, {
    ...(body ? { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  return { status: response.status, data: await response.json() };
}
async function waitJob(id) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const { data } = await request(`/lab-capture/status/${id}`);
    if (['complete', 'completed with errors'].includes(data.status)) return data;
    await delay(500);
  }
  throw new Error(`Capture ${id} did not finish`);
}
async function packets(job, file, filter) {
  const directory = resolve('outputs', 'captures', job.id);
  const { stdout } = await exec('docker', ['run', '--rm', '--network', 'none',
    '--mount', `type=bind,src=${directory},dst=/captures,readonly`, '--entrypoint', 'tshark',
    'ss01-kali:dev', '-r', `/captures/${file}`, '-d', 'tcp.port==8102,tpkt',
    '-d', 'tcp.port==8103,tpkt', '-d', 'tcp.port==8104,tpkt', '-Y', filter,
    '-T', 'fields', '-e', 'frame.number'], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim().split(/\r?\n/).filter(Boolean).length;
}

const discovered = await request('/lab-capture/targets');
assert.equal(discovered.status, 200);
assert.match(discovered.data.project, /^ss01-scenarios-/);
const targets = discovered.data.targets;
for (const name of ['process', 'station', 'supervisory', 'management']) {
  assert.ok(targets.some(target => target.network === name), `No ${name} targets`);
}
assert.equal((await request('/lab-capture/start', { scope: 'lab', target: '', seconds: 10 },
  'http://example.invalid')).status, 403);
assert.equal((await request('/lab-capture/start', { scope: 'interface', target: 'invalid', seconds: 10 })).status, 400);
assert.equal((await request('/lab-capture/start', { scope: 'lab', target: '', seconds: 300 })).status, 400);

const relay = targets.find(target => target.service === 'protection' && target.network === 'station');
assert.ok(relay);
const started = await request('/lab-capture/start', { scope: 'interface', target: relay.id, seconds: 30 });
assert.equal(started.status, 202);
assert.equal(started.data.captures.length, 1);
assert.equal((await request('/lab-capture/start', { scope: 'lab', target: '', seconds: 10 })).status, 400);
const single = await waitJob(started.data.id);
assert.equal(single.status, 'complete', JSON.stringify(single.errors));
assert.ok(await packets(single, single.captures[0].file, 'goose') > 0, 'No GOOSE in interface capture');
assert.equal((await fetch(`${base}/lab-capture/download/${single.id}/${single.captures[0].file}`)).status, 200);
console.log('PASS interface capture, GOOSE decode, download, origin and concurrency guards');

const network = await request('/lab-capture/start', { scope: 'network', target: 'supervisory', seconds: 30 });
assert.equal(network.status, 202);
assert.equal(network.data.captures.length, targets.filter(target => target.network === 'supervisory').length);
await delay(4000);
assert.equal((await request('/lab-capture/stop', { id: network.data.id })).status, 200);
const stopped = await waitJob(network.data.id);
assert.equal(stopped.status, 'complete', JSON.stringify(stopped.errors));
assert.ok(stopped.files.includes('combined.pcapng'));
assert.ok(await packets(stopped, 'combined.pcapng', 'iec60870_104') > 0, 'No IEC 104 in network capture');
assert.ok(await packets(stopped, 'combined.pcapng', 'dnp3') > 0, 'No DNP3 in network capture');
console.log('PASS network capture, early stop, combined PCAPNG, IEC 104 and DNP3 decode');

const lab = await request('/lab-capture/start', { scope: 'lab', target: '', seconds: 30 });
assert.equal(lab.status, 202);
assert.equal(lab.data.captures.length, targets.length);
await exec('docker', ['exec', `${discovered.data.project}-station-hmi-1`, 'station-client'], { timeout: 15000 });
const complete = await waitJob(lab.data.id);
assert.equal(complete.status, 'complete', JSON.stringify(complete.errors));
assert.ok(complete.files.includes('combined.pcapng'));
for (const filter of ['goose', 'iec60870_104', 'dnp3']) {
  assert.ok(await packets(complete, 'combined.pcapng', filter) > 0, `No ${filter} in lab capture`);
}
const station = complete.captures.find(item => item.service === 'station-hmi' && item.network === 'station');
assert.ok(station && await packets(complete, station.file, 'mms') > 0,
  'No MMS decoded in station HMI capture after a fresh association');
console.log(`PASS lab capture: ${targets.length} interfaces, GOOSE, MMS, IEC 104 and DNP3 decoded`);
