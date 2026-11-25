import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const [project, hmi, protection, agent, ...extra] = process.argv.slice(2);
assert.match(project ?? '', /^ss01-capui-[a-z0-9-]+$/, 'Use a uniquely named disposable ss01-capui-* project');
for (const url of [hmi, protection, agent]) assert.match(url ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
assert.equal(extra.length, 0);
const exec = promisify(execFile);
async function json(url, body, origin = agent, extraHeaders = {}) {
  const response = await fetch(url, {
    ...(body ? { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  assert.ok(response.ok, `${url}: ${JSON.stringify(data)}`);
  return data;
}
async function waitFor(fn, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await delay(200);
  }
  assert.fail(`Timed out: ${label}`);
}
async function fields(directory, file, filter, names) {
  const args = ['run', '--rm', '--network', 'none', '--mount',
    `type=bind,src=${directory},dst=/captures,readonly`, '--entrypoint', 'tshark',
    'ss01-kali:dev', '-r', `/captures/${file}`, '-d', 'tcp.port==8102,tpkt',
    '-d', 'tcp.port==8103,tpkt', '-d', 'tcp.port==8104,tpkt', '-Y', filter,
    '-T', 'fields', '-E', 'separator=|', ...names.flatMap(name => ['-e', name])];
  const { stdout } = await exec('docker', args, { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim().split(/\r?\n/).filter(Boolean).map(line => line.split('|'));
}
const targets = await json(agent + '/lab-capture/targets');
assert.equal(targets.project, project);
assert.equal(targets.station, hmi);
const station = targets.targets.find(t => t.service === 'station-hmi' && t.network === 'station');
const breaker = targets.targets.find(t => t.service === 'breaker' && t.network === 'station');
const relay = targets.targets.find(t => t.service === 'protection' && t.network === 'station');
const centre = targets.targets.find(t => t.service === 'control-centre' && t.network === 'supervisory');
assert.ok(station && breaker && relay && centre);
const container = station.id.match(/^([a-f0-9]{64}):/)?.[1];
const relayContainer = relay.id.match(/^([a-f0-9]{64}):/)?.[1];
const centreContainer = centre.id.match(/^([a-f0-9]{64}):/)?.[1];
assert.ok(container && relayContainer && centreContainer);
for (const [id, port, expected] of [[container, '8080/tcp', hmi], [relayContainer, '8090/tcp', protection]]) {
  const { stdout } = await exec('docker', ['port', id, port], { timeout: 15000 });
  assert.equal(`http://${stdout.trim()}`, expected, 'Host endpoint must belong to the selected project');
}
const centrePort = (await exec('docker', ['port', centreContainer, '8090/tcp'], { timeout: 15000 })).stdout.trim();
assert.match(centrePort, /^127\.0\.0\.1:\d+$/);
const centreUrl = `http://${centrePort}`;
const rejected = await fetch(agent + '/lab-capture/start', {
  method: 'POST', headers: { Origin: 'http://example.invalid', 'Content-Type': 'application/json' },
  body: JSON.stringify({ scope: 'network', target: 'station', seconds: 60 }),
});
assert.equal(rejected.status, 403, 'Untrusted origin must be rejected');
const inputOwner = randomUUID();
const current = async value => {
  const result = await json(hmi + '/process-input', { currentA: value }, hmi, {
    'X-SS01-Input-Owner': inputOwner, 'X-SS01-Input-Action': 'apply',
  });
  assert.equal(result.result, 'APPLIED');
  assert.equal(result.currentA, value);
};
const points = async () => (await json(hmi + '/state')).points;
await current(120);
await waitFor(async () => {
  const p = await points();
  return p.current?.quality === 'GOOD' && p.current.value === 120 && p.position?.value === 'CLOSED' && p.trip?.value === false;
}, '120 A, closed and clear');

let job;
let renewalTimer;
let renewalPending = Promise.resolve();
let renewalError;
try {
  job = await json(agent + '/lab-capture/start', { scope: 'lab', target: '', seconds: 60 });
  assert.equal(job.status, 'running');
  assert.ok(job.captures.some(c => c.service === 'station-hmi' && c.network === 'station'));
  await current(250);
  renewalTimer = setInterval(() => {
    renewalPending = renewalPending.then(() => current(250)).catch(error => { renewalError = error; });
  }, 700);
  await waitFor(async () => {
    const p = await points();
    return p.trip?.value === true && p.trip.quality === 'GOOD' && p.current?.value === 250 &&
      p.current.quality === 'GOOD' && p.position?.value === 'OPEN' && p.position.quality === 'GOOD';
  }, '250 A, trip and open contact feedback');
  await waitFor(async () => {
    const p = (await json(centreUrl + '/state')).points;
    return p.trip?.value === true && p.trip.quality === 'GOOD' && p.current?.value === 250 &&
      p.current.quality === 'GOOD' && p.position?.value === 'OPEN' && p.position.quality === 'GOOD';
  }, 'IEC 104 250 A, trip and open');
  await current(250);
  const read = await exec('docker', ['exec', container, 'station-client', 'read'], { timeout: 15000 });
  assert.match(read.stdout, /breaker=OPEN\b/);
  assert.match(read.stdout, /trip=1\b/);
  assert.match(read.stdout, /current_A=250\b/);
  clearInterval(renewalTimer);
  renewalTimer = undefined;
  await renewalPending;
  if (renewalError) throw renewalError;
  await current(120);
  await delay(1000);
  await json(agent + '/lab-capture/stop', { id: job.id });
  job = await waitFor(async () => {
    const status = await json(`${agent}/lab-capture/status/${job.id}`);
    return ['complete', 'completed with errors'].includes(status.status) && status;
  }, 'capture finalization', 90000);
  assert.equal(job.status, 'complete', JSON.stringify(job.errors));
  const stationCapture = job.captures.find(c => c.service === 'station-hmi' && c.network === 'station');
  const breakerCapture = job.captures.find(c => c.service === 'breaker' && c.network === 'station');
  const centreCapture = job.captures.find(c => c.service === 'control-centre' && c.network === 'supervisory');
  assert.ok(stationCapture && breakerCapture && centreCapture);
  const directory = resolve('outputs', 'captures', job.id);
  const syn = await fields(directory, stationCapture.file,
    'tcp.flags.syn == 1 && tcp.flags.ack == 0 && tcp.port == 8103', ['frame.number']);
  const mms = await fields(directory, stationCapture.file, 'mms',
    ['frame.number', 'frame.time_epoch', 'tcp.stream', 'mms.invokeID', '_ws.col.Info',
      'mms.domainId', 'mms.objectName_domain_specific_itemId', 'mms.boolean', 'mms.floating_point', 'mms.data_bit-string']);
  const goose = await fields(directory, breakerCapture.file, 'goose',
    ['frame.number', 'frame.time_epoch', 'goose.boolean', 'goose.bit_string']);
  const iec = await fields(directory, centreCapture.file, 'iec60870_asdu',
    ['frame.number', 'frame.time_epoch', 'iec60870_asdu.ioa', 'iec60870_asdu.diq.dpi',
      'iec60870_asdu.siq.spi', 'iec60870_asdu.float']);
  assert.ok(syn.length, 'No fresh breaker MMS TCP connection');
  const tripGoose = goose.find(row => row[2] === 'True' && row[3] === '0000');
  assert.ok(tripGoose, 'No good asserted GOOSE');
  const iecTrip = iec.find(row => row[2] === '101' && row[4] === 'True');
  const iecOpen = iec.find(row => row[2] === '100' && row[3] === '1');
  const iecCurrent = iec.find(row => row[2] === '102' && Number(row[5]) === 250 && row[5] !== '');
  assert.ok(iecTrip && iecOpen && iecCurrent, 'Missing IEC 104 trip, OPEN or 250 A');
  const values = [
    ['BRF01LD0', 'XCBR1$ST$Pos', row => row[9] === '40,0000'],
    ['PRF01LD0', 'PTRC1$ST$Tr', row => row[7] === 'True' && row[9] === '0000'],
    ['PRF01LD0', 'MMXU1$MX$A$phsA', row => row[8] === '08437a0000' && row[9] === '0000'],
  ];
  for (const [domain, item, matches] of values) {
    const request = mms.find(row => row[4].startsWith('GetDataValueRequest') && row[5] === domain && row[6] === item &&
      Number(row[1]) > Number(tripGoose[1]) && Number(row[1]) > Number(iecOpen[1]));
    assert.ok(request, `No post-trip MMS request for ${domain}/${item}`);
    assert.ok(mms.some(row => row[2] === request[2] && row[4] === 'Associate Request' && Number(row[1]) < Number(request[1])));
    assert.ok(mms.some(row => row[2] === request[2] && row[4] === 'Associate Response' && Number(row[1]) < Number(request[1])));
    const response = mms.find(row => row[2] === request[2] && row[3] === request[3] &&
      row[4].startsWith('GetDataValueResponse success') && Number(row[1]) > Number(request[1]));
    assert.ok(response && matches(response), `Wrong MMS response for ${domain}/${item}: ${response}`);
    console.log(`MMS ${domain}/${item}: request ${request[0]}, response ${response[0]}`);
  }
  console.log(`PASS ${project} capture ${job.id}: GOOSE ${tripGoose[0]}, IEC 104 trip ${iecTrip[0]}, OPEN ${iecOpen[0]}, 250 A ${iecCurrent[0]}`);
  for (const c of [stationCapture, breakerCapture, centreCapture]) console.log(`${c.service}/${c.network}: ${c.detail.replace(/\s+/g, ' ')}`);
} finally {
  clearInterval(renewalTimer);
  await renewalPending;
  await current(120).catch(() => {});
  if (job?.status === 'running') await json(agent + '/lab-capture/stop', { id: job.id }).catch(() => {});
}
