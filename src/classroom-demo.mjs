import assert from 'node:assert/strict';
import { createClassroom } from './classroom.mjs';

const lab = createClassroom();
assert.equal(lab.station().feederCurrentA, 120);
assert.equal(lab.local('open').accepted, true);
assert.equal(lab.station().feederCurrentA, 0);
assert.equal(lab.local('close').accepted, true);
lab.setMode('REMOTE');
assert.equal(lab.local('open').accepted, false);
lab.step();
const initial = lab.supervisory().sample;

lab.setLink(false);
lab.setFault(true);
lab.step();
assert.equal(lab.station().position, 'OPEN');
assert.equal(lab.station().feederCurrentA, 0);
assert.equal(lab.station().tripLatched, true);
assert.deepEqual(lab.supervisory(), { quality: 'STALE', sample: initial });
assert.equal(lab.remote('close').accepted, false);
console.log('WAN down: station OPEN / 0 A, control centre CLOSED / STALE');

lab.setLink(true);
assert.equal(lab.remote('close').accepted, false);
lab.step();
assert.equal(lab.supervisory().quality, 'LIVE');
assert.equal(lab.supervisory().sample.position, 'OPEN');
assert.equal(lab.supervisory().sample.tripLatched, true);
assert.equal(lab.remote('close').accepted, false);
lab.setFault(false);
assert.equal(lab.remote('close').accepted, false);
lab.setMode('LOCAL');
assert.equal(lab.local('reset').accepted, true);
assert.equal(lab.station().position, 'OPEN');
lab.setMode('REMOTE');
assert.equal(lab.remote('close').accepted, true);
assert.equal(lab.station().position, 'CLOSED');
console.log('WAN restored: fresh OPEN received, then reset and explicit close verified');

