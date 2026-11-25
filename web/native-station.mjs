import { drawStationMimic } from './station-mimic.mjs';
import { closeGuidance } from './station-guidance.mjs';

const byId = id => document.getElementById(id);
const canvas = byId('sld');
const drawing = canvas.getContext('2d');
const pointLabels = {
  position: '52-F01 position',
  operationFailure: 'Breaker operation failure',
  closeInhibited: 'Breaker close latch',
  trip: 'Protection trip',
  current: 'Phase A current (PRF01 process input)',
};
const formatTime = ms => ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, -1) : '—';
let lastSnapshot = null;
const controlButtons = [...document.querySelectorAll('[data-action]')];
const commandResult = byId('command-result');
const commandDialog = byId('command-dialog');
const actionLabels = { open: 'OPEN', close: 'CLOSE', 'reset-latch': 'RESET LATCH' };
let pendingAction = null;
let commandInProgress = false;
let latestState = null;
let commandResultTime = 0;
let showInputFeedback;
let showResetFeedback;
let plantCurrent;

const processInputPanel = byId('process-input-panel');
const pickupA = processInputPanel ? Number(processInputPanel.dataset.pickupA) : null;
function inputRejection(response, result) {
  const messages = {
    TAB_CONTROL_LOST: 'This tab lost input control. Click Apply slider value to take control again.',
    TAB_RELOAD_REQUIRED: 'Reload this station tab, then click Apply slider value.',
    INPUT_BUSY: 'A current update is in progress. Wait, then click Apply slider value again.',
    STATION_ORIGIN_REJECTED: 'The station rejected this page’s address. Reopen the local station page.',
  };
  if (response.status === 504) return 'PRF01 did not acknowledge the current before the timeout. Check the readback before retrying.';
  if (response.status === 502 || response.status === 503) return 'The station could not reach PRF01. Check the protection IED status.';
  if (Object.hasOwn(messages, result?.code)) return messages[result.code];
  if (result?.code === 'PRF01_REJECTED') return 'PRF01 rejected the current. ' + (result.result ?? '');
  if (response.ok) return 'The station returned no valid PRF01 acknowledgment.';
  return 'The station rejected Apply (HTTP ' + response.status + '). ' + (result?.result ?? '');
}

if (processInputPanel) {
  const endpoint = processInputPanel.dataset.processInputUrl;
  const owner = crypto.randomUUID();
  const ownerHeaders = { 'Content-Type': 'application/json', 'X-SS01-Input-Owner': owner };
  const slider = byId('process-current');
  const valueOutput = byId('process-current-value');
  const status = byId('process-input-status');
  const faceplateInputStatus = byId('faceplate-input-status');
  const applyButton = byId('apply-process-current');
  const sequenceButton = byId('run-process-sequence');
  const stopButton = byId('stop-process-sequence');
  const resetButton = byId('reset-protection-trip');
  const resetStatus = byId('protection-reset-status');
  let appliedCurrent;
  let inputProblem;
  let lastSentAt = 0;
  let pendingUpdates = 0;
  let inputQueue = Promise.resolve();
  let stoppingSequence = false;
  let sequenceActive = false;
  let sequenceId = 0;
  let resettingTrip = false;
  let waitingForClear = false;

  function selectCurrent(value) {
    slider.value = String(value);
    valueOutput.textContent = value + ' A';
  }

  function setInputStatus(message) {
    for (const output of [status, faceplateInputStatus]) {
      if (output.textContent !== message) output.textContent = message;
    }
  }

  showInputFeedback = point => {
    if (pendingUpdates) return;
    const valid = point?.quality === 'GOOD' && Number.isFinite(point.value);
    const actual = valid ? 'Applied at PRF01: ' + displayValue('current', point.value) : 'No valid current applied to PRF01.';
    const detail = inputProblem ?? (!valid ? 'Click Apply slider value and verify the relay readback.'
      : appliedCurrent === undefined ? 'This tab is not controlling the input. Click Apply slider value to take control.'
        : point.value === appliedCurrent ? 'This tab’s input lease active.'
          : 'The readback differs from this tab’s last acknowledged value.');
    setInputStatus(actual + ' · ' + detail);
  };
  showResetFeedback = points => {
    const current = points?.current;
    const trip = points?.trip;
    if (waitingForClear && trip?.quality === 'GOOD' && trip.value === false) {
      waitingForClear = false;
      resetStatus.textContent = 'PRF01 TRIP CLEAR CONFIRMED · RESET BRF01 CLOSE LATCH IF SET';
    }
    resetButton.disabled = sequenceActive || stoppingSequence || resettingTrip ||
      pendingUpdates > 0 || appliedCurrent === undefined ||
      current?.quality !== 'GOOD' || current.value >= pickupA || trip?.quality !== 'GOOD' || trip.value !== true;
  };

  async function sendCurrent(value, description, { stillRequested = () => true, takeControl = false } = {}) {
    pendingUpdates++;
    const update = inputQueue.then(async () => {
      if (!stillRequested()) return;
      setInputStatus(description);
      await postCurrent(value, takeControl);
    });
    inputQueue = update.catch(() => {});
    try {
      await update;
    } finally {
      pendingUpdates--;
      showInputFeedback(latestState?.points?.current);
      showResetFeedback(latestState?.points);
    }
  }

  async function postCurrent(value, takeControl) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { ...ownerHeaders, ...(takeControl && { 'X-SS01-Input-Action': 'apply' }) },
        body: JSON.stringify({ currentA: value }),
        signal: AbortSignal.timeout(3500),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.result !== 'APPLIED' || !Number.isFinite(result.currentA)) {
        throw new Error(inputRejection(response, result));
      }
      appliedCurrent = result.currentA;
      inputProblem = undefined;
      lastSentAt = Date.now();
    } catch (error) {
      appliedCurrent = undefined;
      inputProblem = error.name === 'TimeoutError' || error.name === 'AbortError'
        ? 'The browser timed out waiting for the station. Check the readback before retrying.'
        : error instanceof TypeError ? 'The browser could not reach the station. Reload this page and retry Apply.'
          : error.message;
      throw error;
    }
  }

  resetButton.addEventListener('click', async () => {
    resetButton.disabled = true;
    resettingTrip = true;
    applyButton.disabled = true;
    sequenceButton.disabled = true;
    waitingForClear = false;
    resetStatus.textContent = 'Requesting PRF01 trip reset…';
    try {
      await inputQueue;
      const response = await fetch(endpoint + '/reset-trip', {
        method: 'POST', headers: ownerHeaders, body: '{}', signal: AbortSignal.timeout(3500),
      });
      const result = await response.json();
      if (!response.ok || result.result !== 'RESET ACCEPTED') throw new Error(result.result || 'IED rejected reset');
      waitingForClear = true;
      resetStatus.textContent = 'PRF01 accepted reset · waiting for clear trip feedback';
    } catch (error) {
      resetStatus.textContent = 'RESET NOT CONFIRMED · ' + error.message;
    } finally {
      resettingTrip = false;
      applyButton.disabled = false;
      sequenceButton.disabled = false;
      showResetFeedback(latestState?.points);
    }
  });

  slider.addEventListener('input', () => {
    valueOutput.textContent = slider.value + ' A';
  });
  applyButton.addEventListener('click', async () => {
    applyButton.disabled = true;
    sequenceButton.disabled = true;
    try {
      await sendCurrent(Number(slider.value), 'Sending current to PRF01...', { takeControl: true });
    } catch (error) {
      console.error('Process-input update:', error.message);
    } finally {
      applyButton.disabled = false;
      sequenceButton.disabled = false;
    }
  });
  sequenceButton.addEventListener('click', async () => {
    if (!window.confirm('Run the simulated feeder-current sequence? PRF01 pickup is ' + pickupA + ' A.')) return;
    const run = ++sequenceId;
    sequenceActive = true;
    showResetFeedback(latestState?.points);
    slider.disabled = true;
    applyButton.disabled = true;
    sequenceButton.disabled = true;
    stopButton.disabled = false;
    try {
      selectCurrent(120);
      await sendCurrent(120, 'Sequence: normal current', { takeControl: true, stillRequested: () => run === sequenceId });
      if (run !== sequenceId) return;
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (run !== sequenceId) return;
      selectCurrent(250);
      await sendCurrent(250, 'Sequence: 250 A', { stillRequested: () => run === sequenceId });
      if (run !== sequenceId) return;
      await new Promise(resolve => setTimeout(resolve, 3000));
      if (run !== sequenceId) return;
      selectCurrent(120);
      await sendCurrent(120, 'Sequence: returning to normal current', { stillRequested: () => run === sequenceId });
    } catch (error) {
      console.error('Process-input sequence:', error.message);
    } finally {
      if (run === sequenceId) {
        sequenceActive = false;
        slider.disabled = false;
        applyButton.disabled = false;
        sequenceButton.disabled = false;
        stopButton.disabled = true;
        showResetFeedback(latestState?.points);
      }
    }
  });
  stopButton.addEventListener('click', async () => {
    sequenceId++;
    sequenceActive = false;
    stoppingSequence = true;
    stopButton.disabled = true;
    selectCurrent(120);
    try {
      await sendCurrent(120, 'Sequence stopped; returning to normal current');
    } catch (error) {
      console.error('Process-input stop:', error.message);
    } finally {
      stoppingSequence = false;
      slider.disabled = false;
      applyButton.disabled = false;
      sequenceButton.disabled = false;
      showResetFeedback(latestState?.points);
    }
  });
  setInterval(() => {
    if (appliedCurrent !== undefined && !pendingUpdates && !stoppingSequence && !resettingTrip &&
        Date.now() - lastSentAt >= 1000) {
      sendCurrent(appliedCurrent, 'Refreshing process-input lease...')
        .catch(error => console.error('Process-input lease:', error.message));
    }
  }, 500);
}

function canOperate(action, points) {
  const required = action === 'open' ? 'CLOSED' : 'OPEN';
  if (commandInProgress || points?.position?.quality !== 'GOOD' || points.position.value !== required) return false;
  if (action === 'open') return true;
  if (pickupA !== null && (points.current?.quality !== 'GOOD' || points.current.value >= pickupA)) return false;
  const latch = points.closeInhibited;
  return latch?.quality === 'GOOD' && latch.value === (action === 'reset-latch') &&
    points.trip?.quality === 'GOOD' && points.trip.value === false;
}

function selectView(view) {
  byId('station-overview').hidden = view !== 'overview';
  byId('station-points').hidden = view !== 'points';
  byId('station-events').hidden = view === 'points';
  byId('station-events').classList.toggle('expanded', view === 'events');
  byId('expand-events').hidden = view === 'events';
  for (const button of document.querySelectorAll('[data-station-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.stationView === view));
  }
}

for (const label of document.querySelectorAll('[data-station-view]')) {
  label.addEventListener('click', () => selectView(label.dataset.stationView));
}
byId('expand-events').addEventListener('click', () => selectView('events'));
byId('breaker-hotspot').addEventListener('click', () => document.querySelector('.station-faceplate').focus());

function updateClock() {
  const time = new Date().toISOString();
  byId('station-clock').dateTime = time;
  byId('station-clock').textContent = time.slice(11, 19) + ' UTC';
}
updateClock();
setInterval(updateClock, 1000);

function displayValue(name, value) {
  if (value == null) return 'UNKNOWN';
  if (name === 'closeInhibited') return value ? 'SET' : 'CLEAR';
  if (typeof value === 'boolean') return value ? 'ASSERTED' : 'CLEAR';
  return name === 'current' ? Number(value).toFixed(1) + ' A' : value;
}

function renderMimic(points) {
  drawStationMimic(drawing, {
    position: points?.position?.quality === 'GOOD' ? points.position.value : null,
    feederCurrentA: plantCurrent,
    relayCurrentA: processInputPanel && points?.current?.quality === 'GOOD' ? points.current.value : null,
    directInput: Boolean(processInputPanel),
  });
}

async function refreshPlantCurrent() {
  try {
    const response = await fetch('/plant-indications', { signal: AbortSignal.timeout(1800) });
    const { current } = await response.json();
    plantCurrent = response.ok && current?.quality === 'GOOD' && Number.isFinite(current.value) &&
      Math.abs(Date.now() - current.observedAt) <= 4500 ? current.value : null;
  } catch {
    plantCurrent = null;
  } finally {
    renderMimic(latestState?.points);
    setTimeout(refreshPlantCurrent, 1000);
  }
}

function render(state) {
  latestState = state;
  const points = state?.points ?? {};
  const read = name => points[name]?.quality === 'GOOD' ? points[name].value : null;
  const position = read('position');
  for (const button of controlButtons) {
    button.disabled = !canOperate(button.dataset.action, points);
  }
  if (pendingAction) byId('confirm-command').disabled = !canOperate(pendingAction, points);
  if (commandResult && !commandInProgress && state?.command?.requestedAt > commandResultTime) {
    commandResultTime = state.command.requestedAt;
    commandResult.textContent = 'Last command: ' + (actionLabels[state.command.action] ?? state.command.action) + ' · ' + state.command.result;
  }
  const guidance = byId('close-guidance');
  if (guidance) {
    guidance.textContent = closeGuidance(points, pickupA);
    guidance.hidden = !guidance.textContent;
  }
  showInputFeedback?.(points.current);
  showResetFeedback?.(points);
  renderMimic(points);
  canvas.setAttribute('aria-label', 'Feeder F01, breaker position ' + (position ?? 'unknown'));
  byId('faceplate-visual').dataset.position = position?.toLowerCase() ?? 'unknown';
  byId('fp-position').textContent = position ?? 'UNKNOWN';
  byId('fp-current').textContent = read('current') == null ? '—' : displayValue('current', read('current'));
  byId('fp-trip').textContent = displayValue('trip', read('trip'));
  byId('fp-failure').textContent = displayValue('operationFailure', read('operationFailure'));
  byId('fp-latch').textContent = displayValue('closeInhibited', read('closeInhibited'));
  byId('fp-quality').textContent = points.position?.quality ?? 'UNKNOWN';
  byId('fp-time').textContent = formatTime(points.position?.sourceTimeMs);
  const activeAlarms = ['operationFailure', 'trip'].filter(name => read(name) === true);
  const alarmSummary = byId('alarm-summary');
  const allKnown = ['operationFailure', 'trip', 'position'].every(name => read(name) != null);
  alarmSummary.dataset.level = activeAlarms.length ? 'alarm' : allKnown ? 'normal' : 'unknown';
  alarmSummary.textContent = activeAlarms.length
    ? activeAlarms.map(name => pointLabels[name]).join('  /  ')
    : allKnown ? 'No active bay alarms' : 'Bay indication unavailable';
  const rows = document.createDocumentFragment();
  for (const [name, label] of Object.entries(pointLabels)) {
    const point = points[name];
    const row = rows.appendChild(document.createElement('tr'));
    row.id = 'point-' + name;
    const heading = row.appendChild(document.createElement('th'));
    heading.scope = 'row';
    heading.textContent = label;
    const source = heading.appendChild(document.createElement('small'));
    source.textContent = point?.source ?? '';
    row.insertCell().textContent = displayValue(name, read(name));
    const quality = row.insertCell();
    quality.textContent = point?.quality ?? 'UNKNOWN';
    quality.classList.toggle('stale', quality.textContent !== 'GOOD');
    row.insertCell().textContent = formatTime(point?.sourceTimeMs);
    row.classList.toggle('trip-alarm', name !== 'closeInhibited' && read(name) === true);
  }
  byId('points').replaceChildren(rows);
  const events = document.createDocumentFragment();
  for (const event of state?.events ?? []) {
    const row = events.appendChild(document.createElement('tr'));
    for (const value of [formatTime(event.observedAt), formatTime(event.sourceTimeMs), event.source, pointLabels[event.point],
      displayValue(event.point, event.value), event.quality]) row.insertCell().textContent = value;
  }
  byId('events').replaceChildren(events);
  const status = state ? 'MMS READER ' + state.reader : 'HMI CONNECTION LOST';
  if (byId('reader').textContent !== status) byId('reader').textContent = status;
}

async function refresh() {
  try {
    const response = await fetch('/state', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Station state unavailable');
    const snapshot = await response.text();
    if (snapshot !== lastSnapshot) render(JSON.parse(snapshot));
    lastSnapshot = snapshot;
  } catch {
    lastSnapshot = null;
    render(null);
  } finally {
    setTimeout(refresh, 500);
  }
}

render(null);
for (const button of controlButtons) {
  button.addEventListener('click', () => {
    pendingAction = button.dataset.action;
    byId('command-prompt').textContent = 'Send ' + actionLabels[pendingAction] + ' to feeder breaker 52-F01?';
    byId('confirm-command').disabled = !canOperate(pendingAction, latestState?.points);
    commandDialog.showModal();
  });
}
if (commandDialog) {
  byId('cancel-command').addEventListener('click', () => commandDialog.close());
  commandDialog.addEventListener('close', () => { pendingAction = null; });
  byId('confirm-command').addEventListener('click', async () => {
    const action = pendingAction;
    if (!action || !canOperate(action, latestState?.points)) return;
    commandDialog.close();
    commandInProgress = true;
    commandResultTime = Math.max(commandResultTime, latestState?.command?.requestedAt ?? 0);
    for (const control of controlButtons) control.disabled = true;
    commandResult.textContent = actionLabels[action] + ' REQUESTED';
    try {
      const response = await fetch('/control/' + action, { method: 'POST', signal: AbortSignal.timeout(6500) });
      const command = await response.json();
      if (typeof command.result !== 'string') throw new Error('Invalid command response');
      commandResultTime = Math.max(commandResultTime, command.requestedAt ?? 0);
      commandResult.textContent = 'Last command: ' + actionLabels[action] + ' · ' + command.result;
    } catch {
      commandResult.textContent = 'COMMAND RESULT UNAVAILABLE · CHECK POSITION';
    } finally {
      commandInProgress = false;
      lastSnapshot = null;
    }
  });
}
refresh();
refreshPlantCurrent();
