import assert from 'node:assert/strict';
import test from 'node:test';
import { closeGuidance } from './station-guidance.mjs';

const good = value => ({ value, quality: 'GOOD' });

test('explains that a set latch cannot be reset while the breaker is closed', () => {
  const points = { position: good('CLOSED'), closeInhibited: good(true), trip: good(false) };
  assert.match(closeGuidance(points), /Reset requires an open breaker and clear protection/);
  points.closeInhibited.quality = 'INVALID';
  assert.equal(closeGuidance(points), '');
});

test('preserves open-breaker guidance for trip, unavailable indications and a set latch', () => {
  const points = { position: good('OPEN'), closeInhibited: good(true), trip: good(true) };
  assert.match(closeGuidance(points), /protection trip asserted/);
  points.trip.quality = 'INVALID';
  assert.match(closeGuidance(points), /permissive status unavailable/);
  points.trip = good(false);
  assert.match(closeGuidance(points), /reset the breaker latch first/);
  points.closeInhibited = good(false);
  assert.equal(closeGuidance(points), '');
});
