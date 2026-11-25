import { yardTelemetry } from './telemetry.mjs';

const byId = id => document.getElementById(id);
const canvas = byId('yard-canvas');
const engineStatus = byId('engine-status');
let viewRevision = 0;
let activeView = 'overview';
window.ss01YardView = 'overview:0';
window.ss01YardSceneReady = false;
window.ss01WalkX = 0;
window.ss01WalkY = 0;
window.ss01Turn = 0;

for (const button of document.querySelectorAll('[data-scenario]')) {
  button.addEventListener('click', async () => {
    const buttons = document.querySelectorAll('[data-scenario]');
    const status = byId('scenario-status');
    buttons.forEach(item => { item.disabled = true; });
    status.textContent = 'Applying...';
    try {
      const response = await fetch('/scenario/' + button.dataset.scenario, { method: 'POST' });
      if (!response.ok) throw new Error('Request failed (' + response.status + ')');
      status.textContent = button.dataset.scenario === 'fault' ? 'SIMF01 fault applied' : 'SIMF01 fault cleared';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      buttons.forEach(item => { item.disabled = false; });
    }
  });
}

function update(state, indications) {
  const readings = yardTelemetry(state, Date.now(), indications);
  window.ss01YardSnapshot = JSON.stringify(readings);
  byId('voltage').textContent = readings.voltage === null ? '—' : readings.voltage.toFixed(2) + ' kV';
  byId('current').textContent = readings.current === null ? '—' : readings.current.toFixed(1) + ' A';
  byId('position').textContent = readings.position;
  byId('position').classList.toggle('alarm', ['UNKNOWN', 'INVALID CONTACTS', 'STALLED'].includes(readings.position));
  byId('position-time').textContent = readings.positionSourceTimeMs
    ? new Date(readings.positionSourceTimeMs).toISOString().slice(11, 23) : '—';
  byId('fault').textContent = readings.fault === null ? 'UNKNOWN' : readings.fault ? 'ACTIVE' : 'CLEAR';
  byId('fault').classList.toggle('alarm', readings.fault === true);
  const contact = state => state === null ? '—' : state ? 'ON' : 'OFF';
  byId('contact-a').textContent = contact(readings.contactA);
  byId('contact-b').textContent = contact(readings.contactB);
  byId('telemetry').textContent = 'Process feedback · ' + readings.quality;
  byId('relay-current').textContent = readings.relayCurrent === null
    ? readings.relayCurrentQuality : readings.relayCurrent.toFixed(1) + ' A · GOOD';
  byId('relay-trip').textContent = readings.relayTrip === null
    ? readings.relayTripQuality : readings.relayTrip ? 'ASSERTED' : 'CLEAR';
  byId('relay-trip').classList.toggle('alarm', readings.relayTrip === true);
  byId('breaker-position').textContent = readings.breakerPosition ?? readings.breakerPositionQuality;
  byId('operation-failure').textContent = readings.operationFailure === null
    ? readings.operationFailureQuality : readings.operationFailure ? 'ASSERTED' : 'CLEAR';
  byId('operation-failure').classList.toggle('alarm', readings.operationFailure === true);
  if (indications && Number.isInteger(indications.stationWebPort) &&
      indications.stationWebPort > 0 && indications.stationWebPort <= 65535) {
    byId('direct-input-help').hidden = !indications.directInput;
    byId('station-input-link').href = 'http://127.0.0.1:' + indications.stationWebPort + '/';
  }
}

const help = {
  overview: 'Follow the 11 kV source through 52-F01 to the outgoing feeder.',
  walk: 'The control-room door is straight ahead. Drag to look, move with WASD or arrows, and turn with Q or E.',
  breaker: 'Inspect the 52-F01 mechanism cabinet and its 52a and 52b contact indicators.',
  room: 'From left to right: protection, bay control, and process I/O.',
  protection: 'PRF01 shows its own input current and trip. SIMF01 plant current is shown on the process I/O panel.',
  bay: 'Breaker position follows the two auxiliary contacts. Check both contacts during a transition.',
  metering: 'Bus voltage is measured upstream of 52-F01. Feeder current can fall to zero while the source bus remains live.',
  'walk-room': 'Drag to look, move with WASD or arrows, and turn with Q or E. The entrance is behind you.',
};
function selectView(view) {
  activeView = view;
  resetMotion();
  window.ss01YardView = view + ':' + ++viewRevision;
  for (const choice of document.querySelectorAll('[data-view]')) {
    choice.setAttribute('aria-pressed', choice.dataset.view === view);
  }
  byId('view-help').textContent = help[view];
  const walking = view.startsWith('walk');
  byId('walk-controls').hidden = !walking;
  canvas.classList.toggle('walking', walking);
  if (walking) canvas.focus();
}
for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => selectView(button.dataset.view));
}
byId('reset-walk').addEventListener('click', () => selectView(activeView));

const motion = {
  left: ['ss01WalkX', -1], right: ['ss01WalkX', 1],
  forward: ['ss01WalkY', -1], back: ['ss01WalkY', 1],
  'turn-left': ['ss01Turn', -1], 'turn-right': ['ss01Turn', 1],
};
const holds = new Map();
function updateMotion() {
  window.ss01WalkX = window.ss01WalkY = window.ss01Turn = 0;
  for (const key of new Set(holds.values())) {
    const [axis, amount] = motion[key];
    window[axis] += amount;
  }
}
function resetMotion() {
  holds.clear();
  updateMotion();
}
for (const button of document.querySelectorAll('[data-motion]')) {
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    button.setPointerCapture(event.pointerId);
    holds.set(event.pointerId, button.dataset.motion);
    updateMotion();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, event => {
      holds.delete(event.pointerId);
      updateMotion();
    });
  }
  button.addEventListener('keydown', event => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    holds.set(button, button.dataset.motion);
    updateMotion();
  });
  function releaseKey() {
    holds.delete(button);
    updateMotion();
  }
  button.addEventListener('keyup', releaseKey);
  button.addEventListener('blur', releaseKey);
}
window.addEventListener('blur', resetMotion);

async function refresh() {
  try {
    const [plant, indications] = await Promise.allSettled(['/state', '/yard/indications'].map(async url => {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500), cache: 'no-store' });
      if (!response.ok) throw new Error('Indications unavailable');
      return response.json();
    }));
    update(plant.value?.component === 'plant' ? plant.value : null, indications.value);
  } finally {
    setTimeout(refresh, 650);
  }
}

async function startYard() {
  try {
    const engine = new Engine({ executable: '/yard/yard', canvas, canvasResizePolicy: 2, focusCanvas: false });
    await engine.startGame();
    const deadline = performance.now() + 5000;
    while (!window.ss01YardSceneReady && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!window.ss01YardSceneReady) throw new Error('Yard scene did not start');
    engineStatus.hidden = true;
  } catch (error) {
    engineStatus.textContent = '3D rendering unavailable. Live process indications are still available.';
    console.error('SIMF01 yard:', error);
  }
}

update(null);
refresh();
if (document.readyState === 'complete') startYard();
else window.addEventListener('load', startYard, { once: true });
