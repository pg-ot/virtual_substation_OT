import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const directory = process.argv[2];
assert.ok(directory && process.argv.length === 3, 'Usage: node containers/scenario-pcap-validation.mjs <capture-directory>');
const exec = promisify(execFile);
async function fields(capture, filter, names, decodeMms = false) {
  const args = ['run', '--rm', '--network', 'none', '--mount',
    `type=bind,src=${resolve(directory)},dst=/captures,readonly`, '--entrypoint', 'tshark',
    'ss01-kali:dev', '-r', `/captures/${capture}`];
  if (decodeMms) args.push('-d', 'tcp.port==8102,tpkt', '-d', 'tcp.port==8103,tpkt',
    '-d', 'tcp.port==8104,tpkt');
  args.push('-Y', filter, '-T', 'fields', '-E', 'separator=|', ...names.flatMap(name => ['-e', name]));
  const { stdout } = await exec('docker', args, { timeout: 60000, maxBuffer: 20 * 1024 * 1024 });
  return stdout.split(/\r?\n/).filter(Boolean).map(line => line.split('|'));
}

const goose = await fields('mms-breaker.pcap', 'goose',
  ['goose.gocbRef', 'goose.datSet', 'goose.confRev', 'goose.appid',
    'goose.stNum', 'goose.boolean', 'goose.bit_string']);
assert.ok(goose.length > 0, 'No GOOSE decoded at breaker');
assert.ok(goose.every(row => row[0] === 'PRF01LD0/LLN0$GO$Protection' &&
  row[1] === 'PRF01LD0/LLN0$ProtectionData' && row[2] === '3' && row[3] === '0x1000'));
assert.ok(goose.some(row => row[5] === 'False' && row[6] === '0000'), 'No good clear GOOSE');
const asserted = goose.findIndex(row => row[5] === 'True' && row[6] === '0000');
assert.ok(asserted >= 0, 'No good asserted GOOSE');
assert.ok(goose.slice(asserted + 1).some(row => row[5] === 'False' && row[6] === '0000'),
  'No subsequent good clear GOOSE');
assert.ok(goose.some(row => row[6] === '4000'), 'No invalid-quality GOOSE');
console.log(`PASS breaker capture: ${goose.length} GOOSE frames; good clear, trip, subsequent clear and invalid quality`);

const mms = await fields('mms-breaker.pcap', 'mms',
  ['mms.domainId', 'mms.objectName_domain_specific_itemId'], true);
assert.ok(mms.some(([domain, item]) => domain === 'BRF01LD0' && item === 'XCBR1$ST$Pos'),
  'No decoded BRF01 position request');
assert.ok(mms.some(([domain, item]) => domain === 'BRF01LD0' && item === 'GGIO1$ST$Ind1'),
  'No decoded BRF01 operation-failure request');
console.log(`PASS breaker capture: ${mms.length} MMS frames and decoded position/failure reads`);

const iec104 = await fields('mms-gateway.pcap', 'iec60870_asdu',
  ['iec60870_asdu.ioa', 'iec60870_asdu.diq.dpi', 'iec60870_asdu.siq.spi', 'iec60870_asdu.float']);
for (const ioa of ['100', '101', '102', '103', '104']) {
  assert.ok(iec104.some(row => row[0] === ioa), `Missing IEC 104 IOA ${ioa}`);
}
for (const value of ['1', '2']) assert.ok(iec104.some(row => row[0] === '100' && row[1] === value));
for (const ioa of ['101', '103', '104']) for (const value of ['True', 'False']) {
  assert.ok(iec104.some(row => row[0] === ioa && row[2] === value), `Missing IOA ${ioa} ${value}`);
}
assert.ok(iec104.some(row => row[0] === '102' && Number(row[3]) === 1200));
console.log(`PASS IEC 104 capture: ${iec104.length} ASDUs; IOAs 100–104, observed states and fault current`);

const dnp = await fields('mms-gateway-dnp3.pcap', 'dnp3',
  ['dnp3.al.obj', 'dnp3.al.2bit', 'dnp3.al.biq.b7', 'dnp3.al.ana.float']);
assert.ok(dnp.some(row => row[0].includes('0x0302')), 'No DNP3 double-bit static object');
assert.ok(dnp.some(row => row[0].includes('0x0102')), 'No DNP3 binary static object');
assert.ok(dnp.some(row => row[0].includes('0x1e05')), 'No DNP3 analog static object');
assert.ok(dnp.some(row => row[3].split(',').some(value => Number(value) === 1200 && value !== '')),
  'No DNP3 1200 A observed');
console.log(`PASS DNP3 capture: ${dnp.length} frames; static binary, double-bit, analog and fault current`);

const http = await fields('http-protection.pcap', 'http.request',
  ['http.request.method', 'http.request.uri', 'http.file_data']);
const bodies = http.filter(row => row[0] === 'POST' && row[1] === '/process-input')
  .map(row => Buffer.from(row[2], 'hex').toString('utf8'));
for (const current of [120, 1200]) {
  assert.ok(bodies.includes(JSON.stringify({ currentA: current })), `Missing HTTP ${current} A request`);
}
assert.ok(http.some(row => row[0] === 'OPTIONS' && row[1] === '/process-input'));
console.log(`PASS direct HTTP capture: ${http.length} requests including preflight, 120 A and 1200 A`);
console.log('Packet evidence is limited to these capture points and does not by itself prove end-to-end operation.');
