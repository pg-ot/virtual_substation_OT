import { createClassroom } from '/src/classroom.mjs';
import { drawYard } from './yard.mjs';
import { drawSingleLine } from './single-line.mjs';

const byId = id => document.getElementById(id);
const set = (id, value) => { byId(id).textContent = value; };
const commands = document.querySelectorAll('[data-action]');
const dialog = byId('confirm');
const drawing = byId('sld').getContext('2d');

let lab;
let pending;
let view = 'overview';
const yard = byId('yard');
const viewpoints = document.querySelectorAll('[data-view]');
const screens = document.querySelectorAll('[data-screen]');
const links = document.querySelectorAll('.lab-nav a');

function showScreen() {
  const requested = location.hash.slice(1);
  const active = [...screens].some(screen => screen.dataset.screen === requested) ? requested : 'station';
  for (const screen of screens) screen.hidden = screen.dataset.screen !== active;
  for (const link of links) {
    if (link.hash === '#' + active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

for (const button of viewpoints) {
  button.onclick = () => {
    view = button.dataset.view;
    for (const camera of viewpoints) camera.setAttribute('aria-pressed', camera === button);
    render();
  };
}

function time(value) {
  return (value / 1000).toFixed(1) + ' s';
}

function render() {
  const station = lab.station();
  const { quality, sample } = lab.supervisory();
  const gateway = lab.gatewayDiagnostics();
  drawSingleLine(drawing, station);
  drawYard(yard, station, view);
  yard.setAttribute('aria-label', 'Switchyard. Breaker ' + station.position +
    '. Relay ' + (station.tripLatched ? 'TRIP' : 'READY') + '.');
  set('local-position', station.position);
  set('local-current', station.feederCurrentA + ' A');
  set('relay-position', station.position);
  set('authority', station.mode);
  set('station-authority', station.mode);
  set('trip-text', station.tripLatched ? 'LATCHED' : 'CLEAR');
  set('station-trip', station.tripLatched ? 'LATCHED' : 'CLEAR');
  byId('trip-lamp').classList.toggle('tripped', station.tripLatched);
  set('remote-position', sample.position);
  set('remote-current', sample.feederCurrentA + ' A');
  set('remote-trip', sample.tripLatched ? 'LATCHED' : 'CLEAR');
  set('quality', quality);
  byId('quality').classList.toggle('stale', quality === 'STALE');
  set('sample-time', time(sample.timeMs));
  set('gateway-link', gateway.available ? 'CONNECTED' : 'DISCONNECTED');
  set('gateway-quality', gateway.quality);
  byId('gateway-quality').classList.toggle('stale', gateway.quality === 'STALE');
  set('gateway-time', time(gateway.sample.timeMs));
  set('gateway-position', gateway.sample.position);
  set('gateway-current', gateway.sample.feederCurrentA + ' A');
  set('gateway-trip', gateway.sample.tripLatched ? 'LATCHED' : 'CLEAR');
  set('wan-status', gateway.available ? 'WAN CONNECTED' : 'WAN DISCONNECTED');
  set('fault', station.fault ? 'Clear fault' : 'Apply fault');
  set('link', gateway.available ? 'Drop WAN' : 'Restore WAN');
  set('mode', station.mode === 'LOCAL' ? 'Select remote' : 'Select local');
  for (const button of commands) {
    button.disabled = button.dataset.origin === 'local'
      ? station.mode !== 'LOCAL'
      : quality !== 'LIVE' || sample.mode !== 'REMOTE';
  }
}

function log(source, event, result) {
  const row = byId('events').insertRow(0);
  for (const value of [time(lab.time()), source, event, result]) {
    row.insertCell().textContent = value;
  }
  if (byId('events').rows.length > 100) byId('events').deleteRow(-1);
  set('operation', event + ' · ' + result);
}

function reset() {
  lab = createClassroom();
  byId('events').replaceChildren();
  log('INSTRUCTOR', 'Exercise initialized', '52-F01 CLOSED');
  render();
}

for (const button of commands) {
  button.onclick = () => {
    pending = button.dataset;
    set('confirm-text', pending.origin.toUpperCase() + ' / 52-F01 / ' + pending.action.toUpperCase());
    dialog.showModal();
  };
}

dialog.addEventListener('close', () => {
  if (dialog.returnValue === 'accept' && pending) {
    const { origin, action } = pending;
    const result = lab[origin](action);
    lab.step();
    log(origin.toUpperCase(), action.toUpperCase(), result.accepted ? 'Accepted' : result.reason);
    if (result.accepted) log('PR-F01', 'Position feedback', lab.station().position);
    render();
  }
  dialog.returnValue = '';
  pending = undefined;
});

byId('fault').onclick = () => {
  const active = !lab.station().fault;
  const before = lab.station().tripLatched;
  lab.setFault(active);
  lab.step();
  log('INSTRUCTOR', active ? 'Feeder fault applied' : 'Feeder fault cleared', lab.station().position);
  if (!before && lab.station().tripLatched) log('PR-F01', 'Protection operated', 'TRIP LATCHED');
  render();
};
byId('link').onclick = () => {
  const available = !lab.gatewayDiagnostics().available;
  lab.setLink(available);
  lab.step();
  log('GATEWAY', available ? 'WAN restored' : 'WAN disconnected', lab.supervisory().quality);
  render();
};
byId('mode').onclick = () => {
  const mode = lab.station().mode === 'LOCAL' ? 'REMOTE' : 'LOCAL';
  lab.setMode(mode);
  lab.step();
  log('PR-F01', 'Control authority', mode);
  render();
};
byId('reset').onclick = reset;
reset();
window.addEventListener('hashchange', showScreen);
showScreen();
