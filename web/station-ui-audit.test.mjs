import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

class Element {
  listeners = new Map();
  children = [];
  dataset = {};
  classes = new Set();
  classList = { toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name) };
  textContent = '';
  drawnText = [];

  addEventListener(event, handler) {
    this.listeners.set(event, handler);
  }
  dispatch(event) {
    return this.listeners.get(event)?.();
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  insertCell() {
    return this.appendChild(new Element());
  }
  replaceChildren(fragment) {
    this.children = [...fragment.children];
  }
  setAttribute() {}
  getContext() {
    const context = {
      clearRect: () => { this.drawnText = []; },
      fillText: text => this.drawnText.push(text),
    };
    return new Proxy(context, { get: (target, key) => target[key] ?? (() => {}) });
  }
}

const point = (value, quality = 'GOOD') => ({ value, quality });
const baseline = {
  position: point('CLOSED'), trip: point(false), current: point(120),
  operationFailure: point(false), closeInhibited: point(false),
};
const readStationHtml = () => readFile(new URL('./native-station.html', import.meta.url), 'utf8');
let fixtureId = 0;

async function loadStation(t, initialPoints = baseline, previousCommand = null) {
  const buttons = ['open', 'close', 'reset-latch'].map(action =>
    Object.assign(new Element(), { dataset: { action } }));
  const elements = new Map([...((await readStationHtml()).matchAll(/\bid="([^"]+)"/g))]
    .map(([, id]) => [id, new Element()]));
  for (const id of ['process-input-panel', 'process-current', 'process-current-value', 'process-input-status',
    'apply-process-current', 'run-process-sequence', 'stop-process-sequence',
    'reset-protection-trip', 'protection-reset-status', 'faceplate-input-status',
    'command-dialog', 'command-prompt', 'cancel-command', 'confirm-command', 'command-result', 'close-guidance',
    'sequence-dialog', 'sequence-prompt', 'cancel-sequence', 'confirm-sequence']) {
    elements.set(id, new Element());
  }
  const element = id => elements.get(id);
  const endpoint = '/process-input';
  element('process-input-panel').dataset.processInputUrl = endpoint;
  element('process-input-panel').dataset.pickupA = '200';
  element('process-current').value = '120';
  for (const dialogId of ['command-dialog', 'sequence-dialog']) {
    const dialog = element(dialogId);
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; dialog.dispatch('close'); };
  }

  let time = 10000;
  let points = initialPoints;
  let finishInput;
  const sent = [];
  const intervals = [];
  const timers = [];
  const moduleUrl = new URL('./native-station.mjs', import.meta.url);
  moduleUrl.searchParams.set('fixture', String(++fixtureId));
  const originals = new Map();
  const replace = (key, value) => {
    originals.set(key, globalThis[key]);
    globalThis[key] = value;
  };
  t.after(() => {
    for (const [key, value] of originals) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });

  replace('document', {
    getElementById: element,
    querySelectorAll: selector => selector === '[data-action]' ? buttons : [],
    createDocumentFragment: () => new Element(),
    createElement: () => new Element(),
  });
  replace('window', { confirm: () => true });
  replace('Date', class extends Date {
    static now() { return time; }
  });
  replace('setInterval', handler => intervals.push(handler));
  replace('setTimeout', (handler, ms) => timers.push({ handler, ms }));
  replace('fetch', async (url, options) => {
    if (url === '/state') return Response.json({ reader: 'READING', points, events: [], command: previousCommand });
    if (url === '/plant-indications') return Response.json({
      current: { ...point(points.position.value === 'OPEN' ? 0 : 118), observedAt: time },
    });
    if (url === '/control/open') throw new TypeError('Request could not reach the station');
    if (url === endpoint + '/reset-trip') return Response.json({ result: 'RESET ACCEPTED' });
    assert.equal(url, endpoint);
    const { currentA } = JSON.parse(options.body);
    sent.push(currentA);
    const outcome = await new Promise(resolve => { finishInput = resolve; });
    if (outcome instanceof Error) throw outcome;
    return outcome ?? Response.json({ result: 'APPLIED', currentA });
  });

  const settle = () => new Promise(resolve => setImmediate(resolve));
  await import(moduleUrl);
  await settle();
  return {
    element, buttons, sent,
    click: id => element(id).dispatch('click'),
    async poll(next) {
      points = next;
      const index = timers.findIndex(timer => timer.ms === 500);
      assert.notEqual(index, -1);
      await timers.splice(index, 1)[0].handler();
    },
    async finishInput(outcome) {
      await settle();
      const finish = finishInput;
      assert.ok(finish, 'expected a pending current update');
      finishInput = undefined;
      finish(outcome);
      await settle();
    },
    async renew() {
      time += 1000;
      for (const handler of intervals) handler();
      await settle();
    },
    async elapse(ms, required = true) {
      const index = timers.findIndex(timer => timer.ms === ms);
      if (!required && index === -1) return;
      assert.notEqual(index, -1, `expected a pending ${ms} ms sequence step`);
      timers.splice(index, 1)[0].handler();
      await settle();
    },
  };
}

test('station disables confirmation when fresh close permissive is lost', async t => {
  const points = { ...baseline, position: point('OPEN') };
  const ui = await loadStation(t, points);
  const close = ui.buttons.find(button => button.dataset.action === 'close');
  assert.equal(close.disabled, false);
  await close.dispatch('click');
  assert.equal(ui.element('confirm-command').disabled, false);
  await ui.poll({ ...points, trip: point(null, 'INVALID') });
  assert.equal(ui.element('confirm-command').disabled, true);
  assert.equal(close.disabled, true);
});

test('faceplate distinguishes unavailable current from a valid readback owned elsewhere', async t => {
  const ui = await loadStation(t, { ...baseline, current: point(null, 'INVALID') });
  const feedback = ui.element('faceplate-input-status');
  assert.match(feedback.textContent, /No valid current applied to PRF01/);
  assert.doesNotMatch(feedback.textContent, /120/);
  await ui.poll(baseline);
  assert.match(feedback.textContent, /Applied at PRF01: 120\.0 A/);
  assert.match(feedback.textContent, /This tab is not controlling the input/);
});

test('Apply failures remain visible on the faceplate across readback polls', async t => {
  const ui = await loadStation(t, { ...baseline, current: point(null, 'INVALID') });
  for (const [failure, expected] of [
    [new DOMException('Timed out', 'TimeoutError'), /browser timed out waiting for the station/],
    [Response.json({ code: 'PRF01_REJECTED', result: 'IED rejected value' }, { status: 422 }), /PRF01 rejected the current/],
  ]) {
    const apply = ui.click('apply-process-current');
    await ui.finishInput(failure);
    await apply;
    await ui.poll(baseline);
    assert.match(ui.element('faceplate-input-status').textContent, expected);
    assert.equal(ui.element('faceplate-input-status').textContent, ui.element('process-input-status').textContent);
  }
  const applied = ui.click('apply-process-current');
  await ui.finishInput();
  await applied;
  await ui.renew();
  await ui.finishInput(Response.json({ code: 'TAB_CONTROL_LOST' }, { status: 409 }));
  assert.match(ui.element('faceplate-input-status').textContent, /This tab lost input control/);
});

test('station blocks close at pickup while protection trip is still clear', async t => {
  const ui = await loadStation(t, { ...baseline, position: point('OPEN'), current: point(200) });
  assert.equal(ui.buttons.find(button => button.dataset.action === 'close').disabled, true);
  assert.match(ui.element('close-guidance').textContent, /at or above pickup/);
});

test('PRF01 reset enables the separate breaker latch reset only after clear feedback', async t => {
  const points = { ...baseline, position: point('OPEN'), trip: point(true), closeInhibited: point(true) };
  const ui = await loadStation(t, points);
  const apply = ui.click('apply-process-current');
  await ui.finishInput();
  await apply;
  const latchReset = ui.buttons.find(button => button.dataset.action === 'reset-latch');
  assert.equal(latchReset.disabled, true);
  assert.equal(ui.element('reset-protection-trip').disabled, false);
  await ui.click('reset-protection-trip');
  assert.match(ui.element('protection-reset-status').textContent, /waiting for clear trip feedback/);
  assert.equal(latchReset.disabled, true);
  await ui.poll({ ...points, trip: point(false) });
  assert.match(ui.element('protection-reset-status').textContent, /TRIP CLEAR CONFIRMED/);
  assert.equal(latchReset.disabled, false);
  assert.equal(ui.buttons.find(button => button.dataset.action === 'close').disabled, true);
});

test('uninterrupted sequence applies normal, fault, and restored current in order', async t => {
  const ui = await loadStation(t);
  const sequence = ui.click('run-process-sequence');
  ui.click('confirm-sequence');
  await ui.finishInput();
  await ui.elapse(2000);
  await ui.finishInput();
  await ui.elapse(3000);
  await ui.finishInput();
  await sequence;
  assert.deepEqual(ui.sent, [120, 250, 120]);
  assert.equal(ui.element('stop-process-sequence').disabled, true);
  assert.equal(ui.element('apply-process-current').disabled, false);
});

test('cancelling the sequence confirmation sends no current', async t => {
  const ui = await loadStation(t);
  const sequence = ui.click('run-process-sequence');
  ui.click('cancel-sequence');
  await sequence;
  assert.deepEqual(ui.sent, []);
  assert.equal(ui.element('sequence-dialog').open, false);
});

test('stale trip does not look ASSERTED or activate the station point alarm', async t => {
  const ui = await loadStation(t, { ...baseline, trip: point(true, 'STALE') });
  const tripRow = ui.element('points').children.find(row => row.id === 'point-trip');
  assert.equal(ui.element('fp-trip').textContent, 'UNKNOWN');
  assert.equal(tripRow.children[2].textContent, 'STALE');
  assert.deepEqual({ value: tripRow.children[1].textContent, alarm: tripRow.classes.has('trip-alarm') },
    { value: 'UNKNOWN', alarm: false });
});

test('lease renewal preserves an edited slider value until Apply', async t => {
  const ui = await loadStation(t);
  const applied = ui.click('apply-process-current');
  await ui.finishInput();
  await applied;
  ui.element('process-current').value = '250';
  ui.element('process-current').dispatch('input');
  await ui.renew();
  await ui.finishInput();
  assert.deepEqual(ui.sent, [120, 120], 'renew the last applied value');
  assert.equal(ui.element('process-current').value, '250', 'leave the draft slider alone');
  assert.equal(ui.element('process-current-value').textContent, '250 A');
});

test('Stop during an in-flight overcurrent update returns PRF01 to 120 A', async t => {
  const ui = await loadStation(t);
  const sequence = ui.click('run-process-sequence');
  ui.click('confirm-sequence');
  await ui.finishInput();
  await ui.elapse(2000);
  assert.deepEqual(ui.sent, [120, 250]);
  assert.equal(ui.element('stop-process-sequence').disabled, false);
  const stopped = ui.click('stop-process-sequence');
  await ui.finishInput();
  if (ui.sent.length > 2) await ui.finishInput();
  await ui.elapse(3000, false);
  await Promise.all([sequence, stopped]);
  const sentWhenStopped = [...ui.sent];
  await ui.renew();
  if (ui.sent.length > sentWhenStopped.length) await ui.finishInput();
  assert.deepEqual({ sentWhenStopped, lastValue: ui.sent.at(-1) },
    { sentWhenStopped: [120, 250, 120], lastValue: 120 });
});

test('input status drops its active-lease claim after PRF01 reports invalid', async t => {
  const ui = await loadStation(t);
  const applied = ui.click('apply-process-current');
  await ui.finishInput();
  await applied;
  assert.match(ui.element('process-input-status').textContent, /lease active/);
  await ui.poll({ ...baseline, current: point(null, 'INVALID'), trip: point(null, 'INVALID') });
  assert.equal(ui.element('fp-current').textContent, '—');
  assert.doesNotMatch(ui.element('process-input-status').textContent, /lease active/);
});

test('station mimic identifies direct HTTP current as a PRF01 input', async t => {
  const ui = await loadStation(t, { ...baseline, position: point('OPEN'), current: point(1200) });
  const labels = ui.element('sld').drawnText;
  assert.ok(labels.includes('1200.0 A'));
  assert.ok(labels.includes('0.0 A'), 'the downstream CT displays plant current');
  assert.ok(labels.some(label => /HTTP|PRF01/i.test(label)),
    `expected source beside injected current. Mimic labels: ${labels.join(' | ')}`);
});

test('a previous success does not overwrite the result of a failed switch request', async t => {
  const ui = await loadStation(t, baseline, { action: 'close', result: 'POSITION CONFIRMED', requestedAt: 9000 });
  const status = ui.element('command-result');
  assert.match(status.textContent, /CLOSE.*POSITION CONFIRMED/);
  const open = ui.buttons.find(button => button.dataset.action === 'open');
  assert.equal(open.disabled, false);
  await open.dispatch('click');
  await ui.click('confirm-command');
  assert.match(status.textContent, /COMMAND RESULT UNAVAILABLE/);
  await ui.poll(baseline);
  assert.match(status.textContent, /COMMAND RESULT UNAVAILABLE/);
});
