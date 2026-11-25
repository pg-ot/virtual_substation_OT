import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const directory = process.argv[2];
assert.ok(directory && process.argv.length === 3,
  'Usage: node containers/iec104-control-pcap-smoke.mjs <capture-directory>');
const exec = promisify(execFile);
const capture = async (filter, fields) => {
  const args = ['run', '--rm', '--network', 'none', '--mount',
    `type=bind,src=${resolve(directory)},dst=/captures,readonly`, '--entrypoint', 'tshark',
    'ss01-kali:dev', '-r', '/captures/control-centre.pcap', '-Y', filter,
    '-T', 'fields', '-E', 'separator=|', ...fields.flatMap(field => ['-e', field])];
  const { stdout } = await exec('docker', args, { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.split(/\r?\n/).filter(Boolean).map(line => line.split('|'));
};

const commands = await capture('iec60870_asdu.typeid == 46',
  ['iec60870_asdu.causetx', 'iec60870_asdu.ioa', 'iec60870_asdu.dco.on',
    'iec60870_asdu.dco.se', 'iec60870_asdu.nega']);
assert.ok(commands.some(([cause, ioa, value, select]) =>
  cause === '6' && ioa === '100' && value === '1' && select === 'True'), 'No OPEN select');
assert.ok(commands.some(([cause, ioa, value, select]) =>
  cause === '6' && ioa === '100' && value === '2' && select === 'True'), 'No CLOSE select');
assert.ok(commands.some(([cause, ioa, value, select]) =>
  cause === '6' && ioa === '100' && value === '1' && select === 'False'), 'No OPEN execute');
assert.ok(commands.some(([cause, ioa, value, select]) =>
  cause === '6' && ioa === '100' && value === '2' && select === 'False'), 'No CLOSE execute');
for (const value of ['1', '2']) {
  assert.ok(commands.some(([cause, ioa, selected, select, negative]) =>
    cause === '10' && ioa === '100' && selected === value && select === 'False' && negative === 'False'),
  `No positive termination for command value ${value}`);
}
assert.ok(commands.some(([cause, ioa, value, select, negative]) =>
  cause === '10' && ioa === '100' && value === '2' && select === 'False' && negative === 'True'),
'No negative close termination for the asserted protection interlock');

const positions = await capture('iec60870_asdu.typeid == 31 && iec60870_asdu.ioa == 100',
  ['iec60870_asdu.diq.dpi']);
assert.ok(positions.some(([position]) => position === '1'), 'No IEC 104 OPEN position feedback');
assert.ok(positions.some(([position]) => position === '2'), 'No IEC 104 CLOSED position feedback');
console.log(`PASS IEC 104 PCAP: ${commands.length} type-46 ASDUs include select/execute, positive feedback and negative interlocked close; position IOA 100 shows OPEN and CLOSED.`);
