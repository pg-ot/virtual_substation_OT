import { access, readFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const [role, interfaceName, buildDirectory = 'build-native'] = process.argv.slice(2);
if (!['protection', 'breaker'].includes(role) || !interfaceName || (role === 'breaker' && interfaceName === '-')) {
  console.error('Usage: node src/native-device-console.mjs protection <interface|-> [build-directory]');
  console.error('       node src/native-device-console.mjs breaker <interface> [build-directory]');
  process.exit(2);
}

const protection = role === 'protection';
const port = Number(process.env.LAB_CONSOLE_PORT ?? (protection ? 8211 : 8212));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid LAB_CONSOLE_PORT');
const origin = 'http://127.0.0.1:' + port;
const executable = name => join(resolve(buildDirectory), name + (process.platform === 'win32' ? '.exe' : ''));
const program = executable(protection ? 'feeder-ied' : 'breaker-ied');
await access(program);
await access(executable(protection ? 'station-client' : 'breaker-read'));

const template = await readFile(new URL('../web/native-device.html', import.meta.url), 'utf8');
const page = template.replaceAll('__ROLE__', role);
const state = { role, interface: interfaceName === '-' ? null : interfaceName, quality: 'UNKNOWN', sample: null };
if (!protection) state.feedback = { quality: 'UNKNOWN', position: null, sourceAt: null };
const events = [];
let lastEvent;
let worker;
let closing = false;
let pollTimer;

function event(message) {
  if (message === lastEvent) return;
  lastEvent = message;
  events.unshift({ time: new Date().toISOString(), message });
  if (events.length > 32) events.pop();
}

function onLine(line) {
  if (!protection) {
    const live = /^GOOSE LIVE stNum=(\d+) sqNum=(\d+) confRev=(\d+) ttl_ms=(\d+) trip=([01])$/.exec(line);
    if (live) {
      const [, stateNumber, sequenceNumber, revision, ttlMs, trip] = live;
      if (state.quality !== 'LIVE' || state.sample?.stateNumber !== Number(stateNumber)) {
        event('GOOSE state ' + stateNumber + ' · trip ' + trip);
      }
      state.quality = 'LIVE';
      state.sample = { trip: trip === '1', stateNumber: Number(stateNumber),
        sequenceNumber: Number(sequenceNumber), revision: Number(revision), ttlMs: Number(ttlMs),
        receivedAt: new Date().toISOString() };
      return;
    }
    if (line.startsWith('GOOSE STALE:')) state.quality = state.sample ? 'STALE' : 'UNKNOWN';
  }
  event(line);
}

async function pollMms() {
  if (closing || worker.exitCode !== null || worker.signalCode !== null) return;
  try {
    const { stdout } = await execute(executable(protection ? 'station-client' : 'breaker-read'),
      protection ? ['read'] : [], { timeout: 2600, windowsHide: true });
    if (!protection) {
      const match = /^breaker=(OPEN|CLOSED|INTERMEDIATE|UNKNOWN) quality=(\d+) source_ms=(\d+)$/m.exec(stdout);
      if (!match) throw new Error('Invalid breaker feedback');
      const [, position, quality, time] = match;
      const alarm = /^operation_failure=([01])$/m.exec(stdout);
      state.feedback = { quality: Number(quality) === 0 ? 'LIVE' : 'INVALID',
        position, sourceAt: Number(time) ? new Date(Number(time)).toISOString() : null,
        operationFailure: alarm ? alarm[1] === '1' : undefined };
      return;
    }
    const match = /^breaker=(OPEN|CLOSED|UNKNOWN) position_quality=(\d+) position_time_ms=(\d+) trip=([01]) current_A=([0-9.]+) trip_quality=(\d+) current_quality=(\d+)/m.exec(stdout);
    if (!match) throw new Error('Invalid MMS status response');
    const [, position, positionQuality, time, trip, current, tripQuality, currentQuality] = match;
    state.quality = Number(tripQuality) === 0 && Number(currentQuality) === 0 ? 'LIVE' : 'INVALID';
    state.sample = { position, trip: trip === '1', currentA: Number(current),
      positionQuality: Number(positionQuality), sourceAt: Number(time) ? new Date(Number(time)).toISOString() : null };
  } catch {
    if (protection) state.quality = state.sample ? 'STALE' : 'UNKNOWN';
    else state.feedback.quality = state.feedback.position ? 'STALE' : 'UNKNOWN';
  } finally {
    if (!closing) pollTimer = setTimeout(pollMms, 500);
  }
}

const actions = new Set(['fault', 'clear', 'reset']);
const server = createServer((request, response) => {
  function send(code, content, type = 'application/json') {
    response.writeHead(code, { 'Content-Type': type + '; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(type === 'text/html' ? content : JSON.stringify(content));
  }
  if (request.headers.host !== '127.0.0.1:' + port) return send(403, { error: 'Use the loopback console address' });
  if (request.method === 'GET' && request.url === '/') return send(200, page, 'text/html');
  if (request.method === 'GET' && request.url === '/state') return send(200, { ...state, events });
  if (request.method === 'POST' && protection && request.url.startsWith('/instructor/')) {
    if (request.headers.origin !== origin) return send(403, { error: 'Use the local protection console' });
    const action = request.url.slice('/instructor/'.length);
    if (!actions.has(action)) return send(404, { error: 'Unknown instructor action' });
    if (!worker?.stdin.writable || worker.exitCode !== null || worker.signalCode !== null) {
      return send(503, { error: 'Protection process is unavailable' });
    }
    worker.stdin.write(action + '\n', error => {
      if (error) send(503, { error: 'Protection process did not receive request' });
      else send(202, { submitted: action });
    });
    return;
  }
  return send(404, { error: 'Unknown route' });
});

server.listen(port, '127.0.0.1');
await once(server, 'listening');
worker = spawn(program, interfaceName === '-' ? [] : [interfaceName], { stdio: ['pipe', 'pipe', 'pipe'] });
worker.stdin.on('error', error => event(error.message));
worker.on('error', error => event(error.message));
worker.on('close', (code, signal) => {
  clearTimeout(pollTimer);
  state.quality = state.sample ? 'STALE' : 'UNKNOWN';
  if (state.feedback) state.feedback.quality = state.feedback.position ? 'STALE' : 'UNKNOWN';
  if (!closing) event('Device process exited (' + (signal || code) + ')');
});
for (const stream of [worker.stdout, worker.stderr]) createInterface({ input: stream }).on('line', onLine);
pollMms();
console.log(role + ' console: ' + origin + '/');

function stop() {
  if (closing) return;
  closing = true;
  clearTimeout(pollTimer);
  if (protection && worker.stdin.writable) worker.stdin.end('quit\n');
  else worker.kill();
  setTimeout(() => {
    if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
  }, 2000).unref();
  server.close();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
if (process.send) process.once('disconnect', stop);

