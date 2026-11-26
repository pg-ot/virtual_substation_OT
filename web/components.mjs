import { components } from './component-catalog.mjs';
import { remoteActionEnabled } from './iec104-controls.mjs';

const byId = id => document.getElementById(id);
const id = document.body.dataset.component;
const device = components[id];
const formatTime = ms => ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, -1) : '—';
const inAlarm = (key, value) => value === true && ['trip', 'fault', 'operationFailure', 'closeInhibited'].includes(key);
const isIed = ['protection', 'breaker'].includes(id);
let selectedIedView = 'overview';
let latestState;
let remoteCommandPending = false;

function display(key, value) {
  if (value == null) return 'UNKNOWN';
  if (key === 'current') return Number(value).toFixed(1) + ' A';
  if (key === 'voltage') return Number(value).toFixed(2) + ' kV';
  if (typeof value === 'boolean') {
    if (key === 'contactA' || key === 'contactB') return value ? 'ON' : 'OFF';
    return value ? 'ASSERTED' : 'CLEAR';
  }
  return value;
}

document.title = 'SS-01 · ' + device.name + ' · ' + device.label;
byId('device-name').textContent = device.name;
byId('device-role').textContent = device.label;
byId('device-interface').textContent = device.interface;
byId('faceplate-title').textContent = device.signals.find(([key]) => key === device.primary)[1];

for (const button of document.querySelectorAll('[data-plant-action]')) {
  button.addEventListener('click', async () => {
    const buttons = document.querySelectorAll('[data-plant-action]');
    const status = byId('plant-action-status');
    buttons.forEach(item => { item.disabled = true; });
    status.textContent = 'Applying...';
    try {
      const response = await fetch('/scenario/' + button.dataset.plantAction, { method: 'POST' });
      if (!response.ok) throw new Error('Request failed (' + response.status + ')');
      status.textContent = button.dataset.plantAction === 'fault' ? 'SIMF01 fault applied' : 'SIMF01 fault cleared';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      buttons.forEach(item => { item.disabled = false; });
    }
  });
}

const remoteUnavailableMessage = 'Controls unavailable: IEC 104 link or fresh position feedback is not GOOD';

function updateRemoteControls(state) {
  const buttons = document.querySelectorAll('[data-remote-action]');
  if (!buttons.length) return;
  for (const button of buttons) {
    button.disabled = !remoteActionEnabled(button.dataset.remoteAction, state, remoteCommandPending);
  }
  const healthy = state && state.service === 'RUNNING' && state.link === 'TRANSFERRING' &&
    state.points?.position?.quality === 'GOOD';
  const status = byId('remote-action-status');
  if (!healthy) {
    if (remoteCommandPending) return;
    status.textContent = remoteUnavailableMessage;
  } else if (status.textContent === remoteUnavailableMessage) {
    status.textContent = 'Ready';
  }
}

function confirmRemote(action) {
  const dialog = byId('remote-dialog');
  if (!dialog) return Promise.resolve(true);
  byId('remote-prompt').textContent = `Send IEC 104 ${action.toUpperCase()} to simulated breaker 52-F01?`;
  let confirmed = false;
  dialog.showModal();
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(confirmed));
    byId('cancel-remote').addEventListener('click', () => dialog.close());
    byId('confirm-remote').addEventListener('click', () => {
      confirmed = true;
      dialog.close();
    });
  });
}

for (const button of document.querySelectorAll('[data-remote-action]')) {
  button.addEventListener('click', async () => {
    const action = button.dataset.remoteAction;
    if (!await confirmRemote(action)) return;
    const buttons = document.querySelectorAll('[data-remote-action]');
    const status = byId('remote-action-status');
    remoteCommandPending = true;
    buttons.forEach(item => { item.disabled = true; });
    status.textContent = 'Command in progress';
    try {
      const response = await fetch('/control/' + action, { method: 'POST' });
      const result = await response.json();
      status.textContent = result.result;
    } catch {
      status.textContent = 'NO RESPONSE';
    } finally {
      remoteCommandPending = false;
      updateRemoteControls(latestState);
    }
  });
}

if (isIed) {
  byId('generic-device').hidden = true;
  byId('ied-panel').hidden = false;
  byId('ied-tag').textContent = device.name;
  byId('ied-function').textContent = id === 'protection' ? 'FEEDER PROTECTION' : 'BAY CONTROL';
  byId('ied-port').textContent = device.interface;
  for (const button of document.querySelectorAll('[data-ied-view]')) {
    button.addEventListener('click', () => {
      selectedIedView = button.dataset.iedView;
      for (const key of document.querySelectorAll('[data-ied-view]')) {
        key.setAttribute('aria-pressed', String(key === button));
      }
      renderIed(latestState);
    });
  }
}

function renderIed(state) {
  const points = state?.points ?? {};
  const read = name => points[name]?.quality === 'GOOD' ? points[name].value : null;
  const screen = byId('ied-screen');
  const content = document.createDocumentFragment();
  const addLine = (label, value) => {
    const row = content.appendChild(document.createElement('div'));
    row.appendChild(document.createElement('span')).textContent = label;
    row.appendChild(document.createElement('strong')).textContent = value;
  };
  byId('ied-screen-title').textContent = { overview: 'OVERVIEW', signals: 'INDICATIONS', events: 'DEVICE EVENTS' }[selectedIedView];
  if (selectedIedView === 'overview') {
    const value = content.appendChild(document.createElement('output'));
    value.className = 'lcd-primary';
    value.textContent = display(device.primary, read(device.primary));
    addLine(id === 'protection' ? 'PHASE A' : 'OP FAILURE',
      id === 'protection' ? display('current', read('current')) : display('operationFailure', read('operationFailure')));
    addLine('DATA LINK', state?.link ?? 'WAITING');
  } else if (selectedIedView === 'signals') {
    for (const [name, label] of device.signals) addLine(label, display(name, read(name)));
    addLine('QUALITY', points[device.primary]?.quality ?? 'UNKNOWN');
  } else {
    for (const event of state?.events.slice(0, 3) ?? []) {
      addLine(new Date(event.at).toISOString().slice(11, 19), event.message);
    }
    if (!content.childNodes.length) addLine('EVENT LOG', 'NO EVENTS');
  }
  screen.replaceChildren(content);

  const indicators = [
    ['SERVICE', state ? state.service === 'RUNNING' : null, 'healthy'],
    ['MMS', state ? state.link === 'READING MMS' : null, 'healthy'],
    ...(id === 'protection'
      ? [['TRIP', read('trip'), 'alarm']]
      : [['CLOSED', read('position') == null ? null : read('position') === 'CLOSED', 'alarm'],
        ['OPEN', read('position') == null ? null : read('position') === 'OPEN', 'healthy'],
        ['OP FAILURE', read('operationFailure'), 'alarm']]),
  ];
  const lamps = document.createDocumentFragment();
  for (const [label, active, tone] of indicators) {
    const row = lamps.appendChild(document.createElement('div'));
    const lamp = row.appendChild(document.createElement('i'));
    lamp.className = 'ied-led';
    lamp.dataset.state = active == null ? 'unknown' : active ? tone : 'off';
    lamp.setAttribute('aria-hidden', 'true');
    row.appendChild(document.createElement('span')).textContent = label;
    row.setAttribute('aria-label', label + ' ' + (active == null ? 'unknown' : active ? 'on' : 'off'));
  }
  byId('ied-indicators').replaceChildren(lamps);
}

function render(state) {
  latestState = state;
  updateRemoteControls(state);
  if (isIed) renderIed(state);
  const points = state?.points ?? {};
  const primary = points[device.primary];
  const alarm = Object.entries(points).some(([key, point]) => point.quality === 'GOOD' && inAlarm(key, point.value));
  byId('faceplate').classList.toggle('device-alarm', alarm);
  byId('faceplate-value').textContent = display(device.primary, primary?.value);
  byId('faceplate-quality').textContent = primary?.quality ?? 'UNKNOWN';
  byId('device-status').textContent = state?.service ?? 'UNAVAILABLE';
  byId('device-link').textContent = state?.link ?? 'UNAVAILABLE';

  const rows = document.createDocumentFragment();
  for (const [key, label, source] of device.signals) {
    const point = points[key];
    const row = rows.appendChild(document.createElement('tr'));
    const heading = row.appendChild(document.createElement('th'));
    heading.scope = 'row';
    heading.textContent = label;
    heading.appendChild(document.createElement('small')).textContent = source;
    row.insertCell().textContent = display(key, point?.value);
    const quality = row.insertCell();
    quality.textContent = point?.quality ?? 'UNKNOWN';
    quality.classList.toggle('stale', quality.textContent !== 'GOOD');
    row.insertCell().textContent = point?.flags == null ? '—' : '0x' + point.flags.toString(16).toUpperCase().padStart(2, '0');
    row.insertCell().textContent = formatTime(point?.sourceTimeMs);
    row.insertCell().textContent = formatTime(point?.observedAt);
    row.classList.toggle('trip-alarm', point?.quality === 'GOOD' && inAlarm(key, point.value));
  }
  byId('points').replaceChildren(rows);

  const log = document.createDocumentFragment();
  for (const event of state?.events ?? []) {
    const row = log.appendChild(document.createElement('tr'));
    row.insertCell().textContent = formatTime(event.at);
    row.insertCell().textContent = event.message;
  }
  byId('events').replaceChildren(log);
}

let last;
async function refresh() {
  let state;
  try {
    const response = await fetch('/state', { signal: AbortSignal.timeout(3500) });
    if (response.ok) {
      const sample = await response.json();
      if (sample.component === id) state = sample;
    }
  } catch {
    // The view shows UNAVAILABLE until the next successful response.
  }
  const snapshot = JSON.stringify(state);
  if (snapshot !== last) render(state);
  last = snapshot;
  setTimeout(refresh, 1500);
}

render(null);
refresh();
