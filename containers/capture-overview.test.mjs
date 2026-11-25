import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';

const source = await readFile(new URL('../web/lab-overview.mjs', import.meta.url), 'utf8');

async function load(result) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'capture-scope' ? 'lab' : '',
      hidden: id === 'capture-overview-link', options: [],
      textContent: '', disabled: false, classList: { toggle() {}, remove() {} },
      addEventListener() {}, replaceChildren() { this.options = []; },
      add(option) { this.options.push(option); }, append() {},
    });
    return elements.get(id);
  }
  const response = data => ({ ok: true, json: async () => data });
  const fetch = async path => {
    if (path === '/lab-overview/config') return response({
      ports: {}, inputMode: 'http', captureAgentUrl: 'http://127.0.0.1:34090',
    });
    if (path === 'http://127.0.0.1:34090/lab-capture/targets') return response(result);
    if (path === '/lab-overview/reachability') return response({ pages: {}, checkedAt: Date.now() });
    if (path === '/state') return response({ reader: 'READING', points: {} });
    throw new Error(`Unexpected request ${path}`);
  };
  runInNewContext(source, {
    document: { getElementById: element, querySelectorAll: () => [], createElement: () => element('created') },
    location: { origin: 'http://127.0.0.1:8080' }, fetch, URL, AbortSignal,
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    setTimeout() {}, console: { error() {} },
  });
  for (let i = 0; i < 50 && element('capture-status').textContent === ''; i++) await delay(2);
  return element;
}

test('links the verified station agent even when its recent capture has finished', async () => {
  const el = await load({
    project: 'ss01-capui-test', station: 'http://127.0.0.1:8080', targets: [{ network: 'station', id: 'target' }],
    recent: { id: '123', status: 'complete', captures: [], errors: [], files: [] },
  });
  assert.equal(el('capture-overview-link').hidden, false);
  assert.equal(el('capture-overview-link').href, 'http://127.0.0.1:34090/lab-overview');
  assert.match(el('capture-overview-note').textContent, /ss01-capui-test/);
  assert.doesNotMatch(el('capture-mms-command').textContent, /docker exec/);
  assert.equal(el('capture-start').disabled, false);
});

test('does not link or enable capture for an agent serving a different station', async () => {
  const el = await load({
    project: 'ss01-capui-other', station: 'http://127.0.0.1:8081', targets: [{ network: 'station', id: 'target' }],
  });
  assert.equal(el('capture-overview-link').hidden, true);
  assert.equal(el('capture-start').disabled, true);
  assert.match(el('capture-status').textContent, /not verified/);
});
