import { execFile, spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { networkInterfaces } from 'node:os';
import { serveSwitchyard } from './yard-web.mjs';

const indication = (value, sourceTimeMs = null, flags = null, quality = 'GOOD') =>
  ({ value, quality, sourceTimeMs, flags });

function plantPoints(output) {
  const match = /^52a=([01]) 52b=([01]) fault=([01]) source_kV=(\S+) feeder_A=(\S+) contact_time_ms=(\d+)/m.exec(output);
  if (!match) throw new Error('Invalid plant readback');
  const [, a, b, fault, voltage, current, time] = match;
  return { contactA: indication(a === '1', Number(time)), contactB: indication(b === '1', Number(time)),
    fault: indication(fault === '1'), voltage: indication(Number(voltage)), current: indication(Number(current)) };
}

function breakerPoints(output) {
  const match = /^breaker=(OPEN|CLOSED|INTERMEDIATE|UNKNOWN) quality=(\d+) source_ms=(\d+)/m.exec(output);
  if (!match) throw new Error('Invalid breaker readback');
  const [, position, flags, time] = match;
  const alarm = /^operation_failure=([01])/m.exec(output);
  const alarmMeta = /^operation_failure_quality=(\d+) source_ms=(\d+)/m.exec(output);
  return {
    position: indication(position, Number(time), Number(flags), Number(flags) === 0 ? 'GOOD' : 'INVALID'),
    ...(alarm && { operationFailure: indication(alarm[1] === '1', Number(alarmMeta?.[2]) || null,
      alarmMeta ? Number(alarmMeta[1]) : null, !alarmMeta || Number(alarmMeta[1]) === 0 ? 'GOOD' : 'INVALID') }),
  };
}

function protectionPoints(output) {
  const data = JSON.parse(output);
  const convert = ({ value, quality, sourceTimeMs }) =>
    indication(value, sourceTimeMs, quality, quality === 0 && value !== null ? 'GOOD' : 'INVALID');
  return { trip: convert(data.trip), current: convert(data.current) };
}

const roles = {
  plant: { command: ['plant-ied'], probe: ['plant-read'], decode: plantPoints },
  'merging-unit': { command: ['merging-unit'] },
  protection: { command: ['feeder-ied'], probe: ['station-client', 'protection-read'], decode: protectionPoints },
  breaker: { command: ['breaker-ied', '--bench'], probe: ['breaker-read'], decode: breakerPoints },
  gateway: { command: ['telecontrol104', 'gateway'] },
  'control-centre': { command: ['telecontrol104', 'master', 'watch'], reconnect: true },
  'gateway-dnp3': { command: ['telecontrol-dnp3', 'outstation'] },
  'control-centre-dnp3': { command: ['telecontrol-dnp3', 'master'] },
};

const [id, directory = '/usr/local/bin'] = process.argv.slice(2);
if (!Object.hasOwn(roles, id)) throw new Error('Unknown SS-01 component: ' + id);
const role = roles[id];
const processInputEnabled = process.env.LAB_HTTP_PROCESS_INPUT === '1';
const plantDirectInput = process.env.LAB_YARD_INPUT_MODE === 'http';
const stationWebPort = Number(process.env.LAB_YARD_STATION_PORT ?? 8080);
const processInputOrigins = new Set((process.env.LAB_PROCESS_INPUT_ALLOWED_ORIGINS || '')
  .split(',').map(origin => origin.trim()).filter(Boolean));
const processInputHost = process.env.LAB_PROCESS_INPUT_HOST || '';
const processInputStation = process.env.LAB_PROCESS_INPUT_STATION_HOST;
if (processInputEnabled && id !== 'protection') {
  throw new Error('LAB_HTTP_PROCESS_INPUT is supported only by the protection IED');
}
if (processInputEnabled && process.env.LAB_SV_PROCESS === '1') {
  throw new Error('HTTP process input and SV process input are mutually exclusive');
}
if (processInputEnabled && (!processInputHost || processInputOrigins.size === 0)) {
  throw new Error('HTTP process input requires an explicit host and allowed-origin list');
}
const [nativeProgram, ...nativeArgs] = role.command;
const nativeEnv = { ...process.env, LAB_WEB_DIAGNOSTICS: '1' };
function interfaceFor(address) {
  return Object.entries(networkInterfaces()).find(([, addresses]) =>
    addresses.some(item => item.family === 'IPv4' && !item.internal && item.address === address))?.[0];
}
if (process.env.LAB_STATION_GOOSE === '1' && ['protection', 'breaker'].includes(id)) {
  const bindAddress = process.env.LAB_BIND_ADDRESS;
  const stationInterface = interfaceFor(bindAddress);
  if (!stationInterface) throw new Error('No station Ethernet interface matches LAB_BIND_ADDRESS');
  nativeArgs.splice(0, nativeArgs.length, stationInterface);
}
if (id === 'merging-unit') {
  const processInterface = interfaceFor(process.env.LAB_BIND_ADDRESS);
  if (!processInterface) throw new Error('No process Ethernet interface matches LAB_BIND_ADDRESS');
  nativeArgs.push(processInterface);
}
if (id === 'protection' && process.env.LAB_SV_PROCESS === '1') {
  const processAddress = await lookup(process.env.LAB_SV_BIND_NAME, { family: 4 });
  nativeEnv.LAB_SV_INTERFACE = interfaceFor(processAddress.address);
  if (!nativeEnv.LAB_SV_INTERFACE) throw new Error('No process Ethernet interface matches LAB_SV_BIND_NAME');
}
const executable = program => resolve(directory, program + (process.platform === 'win32' ? '.exe' : ''));
const state = { component: id, service: 'STARTING', link: 'WAITING', points: {}, events: [] };
let native;
let remoteCommandPending = false;
let retry;
let poll;
let stopping = false;
let pendingScenario;
let pendingProcessInput;
const pages = new Map([
  ['/', ['component.html', 'text/html']],
  ['/station.css', ['station.css', 'text/css']],
  ['/industrial.css', ['industrial.css', 'text/css']],
  ['/components.mjs', ['components.mjs', 'text/javascript']],
  ['/iec104-controls.mjs', ['iec104-controls.mjs', 'text/javascript']],
  ['/component-catalog.mjs', ['component-catalog.mjs', 'text/javascript']],
]);
const pagePolicy = "default-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

function event(message) {
  state.events.unshift({ at: Date.now(), message: message.slice(0, 300) });
  if (state.events.length > 40) state.events.pop();
}

function stalePoints() {
  for (const point of Object.values(state.points)) point.quality = 'STALE';
}

function setLink(next) {
  if (state.link !== next) event('Link ' + next);
  state.link = next;
  if (['WAITING', 'UNAVAILABLE', 'CONNECTING', 'DISCONNECTED'].includes(next)) stalePoints();
}

function setPoints(points) {
  for (const [name, point] of Object.entries(points)) {
    const previous = state.points[name];
    const samePoint = previous?.value === point.value && previous?.quality === point.quality &&
      previous?.flags === point.flags;
    // An untimed integrity scan can confirm the same state without replacing its event time.
    const sourceTimeMs = point.sourceTimeMs || (samePoint ? previous?.sourceTimeMs : null) || null;
    state.points[name] = { ...point, sourceTimeMs, observedAt: Date.now() };
  }
}

function probe(child) {
  const [program, ...args] = role.probe;
  execFile(executable(program), args, { timeout: 2100, windowsHide: true }, (error, stdout) => {
    if (stopping || child !== native || child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (error) throw error;
      setPoints(role.decode(stdout));
      setLink('READING MMS');
    } catch {
      setLink('UNAVAILABLE');
    }
    poll = setTimeout(() => probe(child), 750);
  });
}

function processInputHeaders(origin) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

async function readProcessInput(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1024) throw new RangeError('Request body exceeds 1024 bytes');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function start() {
  const child = spawn(executable(nativeProgram), nativeArgs, {
    env: nativeEnv,
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  native = child;
  child.once('spawn', () => {
    state.service = 'RUNNING';
    event('Native process started');
    if (role.probe) probe(child);
  });
  const stdout = createInterface({ input: child.stdout });
  const stderr = createInterface({ input: child.stderr });
  stdout.on('line', line => {
    if (pendingScenario && line === 'Plant applied ' + pendingScenario.action) {
      pendingScenario.finish(200, 'APPLIED');
    }
    if (line) event(line);
    console.log(line);
    if (pendingProcessInput?.reset) {
      if (line === 'Applied reset') pendingProcessInput.finish(200, { result: 'RESET ACCEPTED' });
      else if (line.startsWith('Rejected. Available actions:')) pendingProcessInput.finish(409, {
        result: 'PRF01 RESET REJECTED · CHECK VALID CURRENT BELOW PICKUP AND CLEAR PLANT FAULT',
      });
      return;
    }
    const processInputResult = /^PROCESS_INPUT_(APPLIED|REJECTED)(?: current_A=(\S+)| reason=(.+))?$/.exec(line);
    if (pendingProcessInput && processInputResult) {
      if (processInputResult[1] === 'APPLIED') {
        pendingProcessInput.finish(200, {
          result: 'APPLIED',
          currentA: Number(processInputResult[2]),
          leaseMs: 3000,
        });
      } else {
        pendingProcessInput.finish(422, {
          result: 'REJECTED',
          reason: processInputResult[3] || 'IED rejected process input',
        });
      }
    }
  });
  stderr.on('line', line => {
    if (!line.startsWith('@ss01 ')) {
      if (line) event(line);
      console.error(line);
      return;
    }
    try {
      const update = JSON.parse(line.slice(6));
      if (update.link) setLink(update.link);
      if (update.points) setPoints(update.points);
    } catch {
      console.error('Invalid native component status');
    }
  });
  child.stdin.on('error', () => {});
  child.on('error', error => event(error.message));
  child.once('close', (code, signal) => {
    pendingScenario?.finish(503, 'PROCESS UNAVAILABLE');
    pendingProcessInput?.finish(503, { result: 'PROCESS UNAVAILABLE' });
    clearTimeout(poll);
    stdout.close();
    stderr.close();
    state.service = 'OFFLINE';
    setLink('DISCONNECTED');
    event('Native process exited (' + (signal || code) + ')');
    if (!stopping && role.reconnect) retry = setTimeout(start, 1000);
  });
}

const address = await lookup(process.env.LAB_WEB_BIND_NAME || '127.0.0.1', { family: 4 });
const server = createServer(async (request, response) => {
  const resetTrip = request.url === '/process-input/reset-trip';
  if (processInputEnabled && (request.url === '/process-input' || resetTrip)) {
    const origin = request.headers.origin || '';
    if (!processInputOrigins.has(origin) || request.headers.host !== processInputHost) {
      response.writeHead(403, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    if (processInputStation || resetTrip) {
      const station = processInputStation && await lookup(processInputStation, { family: 4 }).catch(() => null);
      const peer = request.socket.remoteAddress?.replace(/^::ffff:/, '');
      if (!station || peer !== station.address) {
        response.writeHead(403, { 'Cache-Control': 'no-store' }).end();
        return;
      }
    }
    if (request.method === 'OPTIONS') {
      const requestedHeaders = (request.headers['access-control-request-headers'] || '')
        .split(',').map(header => header.trim().toLowerCase()).filter(Boolean);
      if (request.headers['access-control-request-method'] !== 'POST' ||
          requestedHeaders.some(header => header !== 'content-type')) {
        response.writeHead(403, processInputHeaders(origin)).end(JSON.stringify({ result: 'PREFLIGHT REJECTED' }));
        return;
      }
      response.writeHead(204, processInputHeaders(origin)).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST, OPTIONS', 'Cache-Control': 'no-store' }).end();
      return;
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
      response.writeHead(415, processInputHeaders(origin)).end(JSON.stringify({ result: 'JSON REQUIRED' }));
      return;
    }
    if (pendingProcessInput) {
      response.writeHead(409, processInputHeaders(origin)).end(JSON.stringify({ result: 'INPUT BUSY' }));
      return;
    }
    if (!native?.stdin.writable || state.service !== 'RUNNING') {
      response.writeHead(503, processInputHeaders(origin)).end(JSON.stringify({ result: 'IED UNAVAILABLE' }));
      return;
    }
    let body;
    try {
      body = await readProcessInput(request);
    } catch (error) {
      const status = error instanceof RangeError ? 413 : 400;
      response.writeHead(status, processInputHeaders(origin))
        .end(JSON.stringify({ result: status === 413 ? 'BODY TOO LARGE' : 'INVALID JSON' }));
      return;
    }
    if (resetTrip ? !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0 :
        !body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || typeof body.currentA !== 'number' ||
        !Number.isFinite(body.currentA) || body.currentA < 0 || body.currentA > 1200) {
      response.writeHead(422, processInputHeaders(origin)).end(JSON.stringify({
        result: resetTrip ? 'RESET REQUIRES AN EMPTY JSON OBJECT' : 'currentA must be a number from 0 to 1200',
      }));
      return;
    }
    if (pendingProcessInput) {
      response.writeHead(409, processInputHeaders(origin)).end(JSON.stringify({ result: 'INPUT BUSY' }));
      return;
    }
    const finish = (status, result) => {
      if (!pendingProcessInput || pendingProcessInput.finish !== finish) return;
      clearTimeout(pendingProcessInput.timer);
      pendingProcessInput = undefined;
      response.writeHead(status, processInputHeaders(origin)).end(JSON.stringify(result));
    };
    pendingProcessInput = {
      finish, reset: resetTrip,
      timer: setTimeout(() => finish(504, { result: 'IED ACKNOWLEDGEMENT TIMEOUT' }), 2000),
    };
    native.stdin.write(resetTrip ? 'reset\n' : `process-input ${body.currentA}\n`, error => {
      if (error) finish(503, { result: 'IED UNAVAILABLE' });
    });
    return;
  }
  const remoteCommand = /^\/control\/(open|close)$/.exec(request.url);
  if (id === 'control-centre' && process.env.LAB_IEC104_CONTROL === '1' &&
      request.method === 'POST' && remoteCommand) {
    const host = request.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) || request.headers.origin !== 'http://' + host) {
      response.writeHead(403).end();
      return;
    }
    if (remoteCommandPending || state.link !== 'TRANSFERRING') {
      response.writeHead(remoteCommandPending ? 409 : 503).end();
      return;
    }
    remoteCommandPending = true;
    const action = remoteCommand[1];
    execFile(executable('telecontrol104'), ['master', action], { env: nativeEnv, timeout: 16000 }, (error, stdout) => {
      remoteCommandPending = false;
      const result = /^command=(POSITION CONFIRMED|REJECTED OR NOT CONFIRMED|REJECTED|NO RESPONSE)$/m.exec(stdout)?.[1] || 'NO RESPONSE';
      event('IEC 104 ' + action.toUpperCase() + ' ' + result);
      response.writeHead(!error && result === 'POSITION CONFIRMED' ? 200 : 409,
        { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ action, result }));
    });
    return;
  }
  const scenario = /^\/scenario\/(fault|clear)$/.exec(request.url);
  if (id === 'plant' && request.method === 'POST' && scenario) {
    const host = request.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) || request.headers.origin !== 'http://' + host) {
      response.writeHead(403).end();
      return;
    }
    if (pendingScenario || !native?.stdin.writable || state.service !== 'RUNNING') {
      response.writeHead(pendingScenario ? 409 : 503).end();
      return;
    }
    const action = scenario[1];
    const finish = (status, result) => {
      if (!pendingScenario || pendingScenario.finish !== finish) return;
      clearTimeout(pendingScenario.timer);
      pendingScenario = undefined;
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ action, result }));
    };
    pendingScenario = { action, finish, timer: setTimeout(() => finish(504, 'TIMEOUT'), 3000) };
    native.stdin.write(action + '\n', error => { if (error) finish(503, 'PROCESS UNAVAILABLE'); });
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (id === 'plant' && request.url === '/yard/indications') {
    async function readPeer(component) {
      try {
        const result = await fetch(`http://web-${component}:8090/state`, {
          redirect: 'error', signal: AbortSignal.timeout(1400),
        });
        if (!result.ok) return null;
        const snapshot = await result.json();
        return snapshot.component === component ? snapshot.points : null;
      } catch {
        return null;
      }
    }
    const [protection, breaker] = await Promise.all([readPeer('protection'), readPeer('breaker')]);
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(
      JSON.stringify({ protection, breaker, directInput: plantDirectInput, stationWebPort }));
    return;
  }
  if (id === 'plant' && await serveSwitchyard(request, response)) return;
  if (request.url === '/state') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify(state));
    return;
  }
  const page = pages.get(request.url);
  if (!page) {
    response.writeHead(404).end();
    return;
  }
  const [file, type] = page;
  try {
    const body = await readFile(new URL('../web/' + file, import.meta.url), 'utf8');
    const headers = { 'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
    if (type === 'text/html') {
      headers['Content-Security-Policy'] = pagePolicy;
      const yardLink = id === 'plant' ? '<a class="device-yard-link" href="/yard/">3D switchyard</a>' : '';
      const controls = id === 'plant' ? `<section class="plant-controls" aria-labelledby="plant-controls-title">
        <h2 id="plant-controls-title">Process disturbance</h2>
        <p>${plantDirectInput
          ? 'This control changes SIMF01 only. Apply relay current through the station HMI’s direct HTTP input.'
          : 'A plant fault produces 1200 A while the breaker is closed. After clearing, use the instructor console to restore the breaker.'}</p>
        <button type="button" data-plant-action="fault">Apply SIMF01 fault</button>
        <button type="button" data-plant-action="clear">Clear SIMF01 fault</button>
        <output id="plant-action-status" aria-live="polite"></output>
      </section>` : '';
      const remoteControls = id === 'control-centre' && process.env.LAB_IEC104_CONTROL === '1' ?
        `<section class="plant-controls" aria-labelledby="remote-controls-title">
        <h2 id="remote-controls-title">52-F01 remote control · IEC 104</h2>
        <p>Supervised simulated control uses IEC 104 select-before-operate. Confirm each command. Position feedback and breaker interlocks remain authoritative.</p>
        <button type="button" data-remote-action="open" disabled>Open</button>
        <button type="button" data-remote-action="close" disabled>Close</button>
        <output id="remote-action-status" aria-live="polite"></output>
      </section>` : '';
      response.writeHead(200, headers).end(body.replace('__COMPONENT_ID__', id)
        .replace('<!-- PLANT_YARD_LINK -->', yardLink).replace('<!-- PLANT_SCENARIO_CONTROLS -->', controls + remoteControls));
      return;
    }
    response.writeHead(200, headers).end(body);
  } catch {
    response.writeHead(500).end();
  }
});

server.listen(Number(process.env.LAB_WEB_PORT || 8090), address.address, () => {
  console.log(id + ' web UI ready on ' + address.address + ':' + server.address().port);
  start();
});
process.stdin.on('data', chunk => {
  if (native?.stdin.writable) native.stdin.write(chunk);
});
function stop() {
  stopping = true;
  clearTimeout(retry);
  clearTimeout(poll);
  process.stdin.pause();
  native?.kill();
  server.close();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
if (process.send) process.once('disconnect', stop);
