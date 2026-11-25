import assert from 'node:assert/strict';
import test from 'node:test';
import { remoteActionEnabled } from './iec104-controls.mjs';

const healthy = {
  service: 'RUNNING',
  link: 'TRANSFERRING',
  points: {
    position: { value: 'OPEN', quality: 'GOOD' },
    trip: { value: false, quality: 'GOOD' },
    closeInhibited: { value: false, quality: 'GOOD' },
  },
};

test('exposes only the action opposite to fresh IEC 104 position feedback', () => {
  assert.equal(remoteActionEnabled('close', healthy), true);
  assert.equal(remoteActionEnabled('open', healthy), false);
  assert.equal(remoteActionEnabled('open', { ...healthy, points: { ...healthy.points,
    position: { value: 'CLOSED', quality: 'GOOD' } } }), true);
  assert.equal(remoteActionEnabled('close', { ...healthy, points: { ...healthy.points,
    position: { value: 'CLOSED', quality: 'GOOD' } } }), false);
});

test('disables controls when link, service, or position feedback is not trustworthy', () => {
  assert.equal(remoteActionEnabled('close', { ...healthy, link: 'DISCONNECTED' }), false);
  assert.equal(remoteActionEnabled('close', { ...healthy, service: 'OFFLINE' }), false);
  assert.equal(remoteActionEnabled('close', { ...healthy, points: { ...healthy.points,
    position: { value: 'OPEN', quality: 'STALE' } } }), false);
  assert.equal(remoteActionEnabled('close', { ...healthy, points: {} }), false);
});

test('serializes commands but leaves final interlock decisions to BRF01', () => {
  assert.equal(remoteActionEnabled('close', healthy, true), false);
  const interlocked = { ...healthy, points: { ...healthy.points,
    trip: { value: true, quality: 'GOOD' },
    closeInhibited: { value: true, quality: 'GOOD' },
  } };
  assert.equal(remoteActionEnabled('close', interlocked), true);
});
