import assert from 'node:assert/strict';
import { yardTelemetry } from '../../web/yard/telemetry.mjs';

const now = 10_000;
const sample = (values, observedAt = now) => ({
  points: Object.fromEntries(Object.entries(values).map(([key, value]) =>
    [key, { value, quality: 'GOOD', observedAt }])),
});
const normal = { contactA: true, contactB: false, fault: false, voltage: 11, current: 120 };
const closed = yardTelemetry(sample(normal), now);
assert.equal(closed.quality, 'LIVE');
assert.equal(closed.position, 'CLOSED');
const stuck = yardTelemetry(sample({ ...normal, fault: true, current: 1200 }), now);
assert.equal(stuck.position, 'CLOSED');
assert.equal(stuck.current, 1200);
assert.equal(stuck.fault, true);
const open = yardTelemetry(sample({ ...normal, contactA: false, contactB: true, fault: true, current: 0 }), now);
assert.equal(open.position, 'OPEN');
assert.equal(open.current, 0);
assert.equal(open.energized, true);
assert.equal(open.fault, true);
assert.equal(yardTelemetry(sample({ ...normal, contactA: false }), now).position, 'IN TRANSIT');
const stalled = sample({ ...normal, contactA: false });
stalled.points.contactA.sourceTimeMs = stalled.points.contactB.sourceTimeMs = now - 950;
assert.equal(yardTelemetry(stalled, now).position, 'STALLED');
assert.equal(yardTelemetry(stalled, now).positionSourceTimeMs, now - 950);
stalled.points.contactA.observedAt = stalled.points.contactB.observedAt = now - 1;
assert.equal(yardTelemetry(stalled, now).position, 'IN TRANSIT');
assert.equal(yardTelemetry(sample({ ...normal, contactB: true }), now).position, 'INVALID CONTACTS');
assert.equal(yardTelemetry(sample(normal, 1000), now).position, 'UNKNOWN');
const partial = sample(normal);
partial.points.contactA.quality = 'STALE';
assert.equal(yardTelemetry(partial, now).quality, 'PARTIAL');
assert.equal(yardTelemetry(partial, now).position, 'UNKNOWN');

const expired = sample({ ...normal, fault: true, current: 1200 });
expired.points.fault.observedAt = now - 4501;
expired.points.current.observedAt = now - 4501;
const expiredReadings = yardTelemetry(expired, now);
assert.equal(expiredReadings.position, 'CLOSED');
assert.equal(expiredReadings.fault, null, 'Expired fault cannot appear active or clear');
assert.equal(expiredReadings.current, null, 'Expired current cannot look like a live measurement');
assert.equal(expiredReadings.quality, 'PARTIAL');

const lostContacts = sample({ ...normal, fault: true, current: 1200 });
lostContacts.points.contactA.quality = 'INVALID';
lostContacts.points.contactB.quality = 'INVALID';
const lostReadings = yardTelemetry(lostContacts, now);
assert.equal(lostReadings.position, 'UNKNOWN', 'Current and fault cannot prove position');
assert.equal(lostReadings.current, 1200);
assert.equal(lostReadings.fault, true);

const impossible = sample({ ...normal, current: '1200', voltage: Infinity, fault: 'true' });
const unknown = yardTelemetry(impossible, now);
assert.equal(unknown.current, null);
assert.equal(unknown.voltage, null);
assert.equal(unknown.energized, null);
assert.equal(unknown.fault, null);
const protection = sample({ current: 250, trip: true }).points;
const breaker = sample({ position: 'CLOSED', operationFailure: true }).points;
const withIeds = yardTelemetry(sample({ ...normal, current: 1200, fault: true }), now, { protection, breaker });
assert.equal(withIeds.current, 1200);
assert.equal(withIeds.relayCurrent, 250);
assert.equal(withIeds.relayCurrentQuality, 'GOOD');
assert.equal(withIeds.relayTrip, true);
assert.equal(withIeds.operationFailure, true);
assert.equal(withIeds.breakerPosition, 'CLOSED');
protection.current.quality = 'INVALID';
protection.trip.observedAt = now - 4501;
const degraded = yardTelemetry(sample(normal), now, { protection });
assert.equal(degraded.current, 120);
assert.equal(degraded.relayCurrent, null);
assert.equal(degraded.relayCurrentQuality, 'INVALID');
assert.equal(degraded.relayTrip, null);
assert.equal(degraded.relayTripQuality, 'STALE');
assert.equal(degraded.operationFailureQuality, 'UNAVAILABLE');
console.log('Yard telemetry passed contact states, travel, independent expiry, and malformed feedback checks.');
