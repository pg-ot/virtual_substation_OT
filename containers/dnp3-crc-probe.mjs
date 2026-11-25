import assert from 'node:assert/strict';
import { createConnection } from 'node:net';

// Class 1/2 read from the captured SS-01 exchange, master 1 to outstation 10.
const request = Buffer.from('05640ec40a0001002529e1c0013c02063c0306668d', 'hex');
const badHeader = Buffer.from(request);
badHeader[8] ^= 1;
const host = process.argv[2] || 'dnp3-supervisory';

function exchange(frame) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port: 20000 });
    const chunks = [];
    socket.setTimeout(2500);
    socket.on('connect', () => socket.write(frame));
    socket.on('data', chunk => { chunks.push(chunk); socket.end(); });
    socket.on('timeout', () => { socket.destroy(); resolve(Buffer.concat(chunks)); });
    socket.on('end', () => resolve(Buffer.concat(chunks)));
    socket.on('error', reject);
  });
}

const corrupted = await exchange(badHeader);
assert.equal(corrupted.length, 0, 'Outstation responded to a corrupted header CRC');
const valid = await exchange(request);
assert.ok(valid.length >= 10 && valid[0] === 0x05 && valid[1] === 0x64,
  'No DNP3 response to the unmodified request');
console.log(`DNP3 CRC test passed: corrupted header received no response, valid request received ${valid.length} bytes.`);
