import { setTimeout as delay } from 'node:timers/promises';

export async function state(origin) {
  const response = await fetch(origin + '/state', { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`State request failed: ${response.status}`);
  return response.json();
}

export async function operate(origin, name, expected) {
  const deadline = Date.now() + 3000;
  while (true) {
    const response = await fetch(origin + '/control/' + name, {
      method: 'POST', headers: { Origin: origin }, signal: AbortSignal.timeout(12000),
    });
    const result = await response.json();
    if (response.ok && result.result === expected) {
      console.log(`${new Date().toISOString()} HMI: ${result.result}`);
      return;
    }
    if (!['close', 'reset-latch'].includes(name) || response.status !== 409 ||
        result.result !== 'REJECTED' || Date.now() >= deadline) {
      throw new Error(`${name}: ${JSON.stringify(result)}`);
    }
    const points = (await state(origin)).points;
    const expectedLatch = name === 'reset-latch';
    if (points.position?.value !== 'OPEN' || points.position.quality !== 'GOOD' ||
        points.closeInhibited?.value !== expectedLatch || points.closeInhibited.quality !== 'GOOD' ||
        points.trip?.value !== false || points.trip.quality !== 'GOOD') {
      throw new Error(`${name}: ${JSON.stringify(result)}`);
    }
    await delay(250);
  }
}
