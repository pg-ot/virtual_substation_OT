import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { operate } from './instructor-control.mjs';

async function withStation(points, firstStatus, callback) {
  let requests = 0;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/state') return response.end(JSON.stringify({ points }));
    requests++;
    response.statusCode = requests === 1 ? firstStatus : 200;
    const confirmed = request.url === '/control/close' ? 'POSITION CONFIRMED' : 'LATCH RESET CONFIRMED';
    response.end(JSON.stringify({ result: requests === 1 ? 'REJECTED' : confirmed }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await callback('http://127.0.0.1:' + server.address().port, () => requests);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
}

const good = value => ({ value, quality: 'GOOD' });
const normal = () => ({ position: good('OPEN'), closeInhibited: good(true), trip: good(false) });

test('retries a rejected latch reset when the observed interlocks remain clear', async () => {
  await withStation(normal(), 409, async (origin, requests) => {
    await operate(origin, 'reset-latch', 'LATCH RESET CONFIRMED');
    assert.equal(requests(), 2);
  });
});

test('retries a rejected close when the latch and trip are clear', async () => {
  const points = normal();
  points.closeInhibited.value = false;
  await withStation(points, 409, async (origin, requests) => {
    await operate(origin, 'close', 'POSITION CONFIRMED');
    assert.equal(requests(), 2);
  });
});

for (const [description, change] of [
  ['protection trip is asserted', points => { points.trip.value = true; }],
  ['trip quality is invalid', points => { points.trip.quality = 'INVALID'; }],
  ['breaker is closed', points => { points.position.value = 'CLOSED'; }],
  ['latch indication is unavailable', points => { points.closeInhibited.quality = 'INVALID'; }],
]) {
  test('does not retry when ' + description, async () => {
    const points = normal();
    change(points);
    await withStation(points, 409, async (origin, requests) => {
      await assert.rejects(operate(origin, 'reset-latch', 'LATCH RESET CONFIRMED'));
      assert.equal(requests(), 1);
    });
  });
}

test('does not retry an unconfirmed command', async () => {
  await withStation(normal(), 504, async (origin, requests) => {
    await assert.rejects(operate(origin, 'reset-latch', 'LATCH RESET CONFIRMED'));
    assert.equal(requests(), 1);
  });
});
