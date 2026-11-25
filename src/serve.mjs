import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { startNativeStation } from './native-station.mjs';

const native = process.argv[2] === '--native'
  ? await startNativeStation(process.argv[3] ?? 'build-native') : null;
const processInputUrl = process.env.LAB_PROCESS_INPUT_URL ? new URL(process.env.LAB_PROCESS_INPUT_URL) : null;
if (processInputUrl && (processInputUrl.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(processInputUrl.hostname) ||
    processInputUrl.pathname !== '/process-input' ||
    processInputUrl.username || processInputUrl.password || processInputUrl.search || processInputUrl.hash)) {
  throw new Error('LAB_PROCESS_INPUT_URL must be a loopback HTTP /process-input endpoint');
}
const processInputUpstream = processInputUrl && (process.env.LAB_PROCESS_INPUT_INTERNAL === '1'
  ? new URL('http://web-protection:8090/process-input') : processInputUrl);
const protectionPickupA = Number(process.env.LAB_PROTECTION_PICKUP_A ?? 200);
if (processInputUrl && (!Number.isFinite(protectionPickupA) || protectionPickupA <= 0)) {
  throw new Error('LAB_PROTECTION_PICKUP_A must be a positive number');
}
let processInputOwner;
let processInputBusy = false;
let appliedProcessCurrent;
const capturePort = process.env.LAB_CAPTURE_AGENT_PORT ?? '34090';
if (!/^\d+$/.test(capturePort) || Number(capturePort) < 1 || Number(capturePort) > 65535) {
  throw new Error('LAB_CAPTURE_AGENT_PORT must be a valid TCP port');
}
const captureAgentUrl = `http://127.0.0.1:${capturePort}`;
const overviewPorts = Object.fromEntries(Object.entries({
  plant: ['LAB_OVERVIEW_PLANT_PORT', 8081],
  protection: ['LAB_OVERVIEW_PROTECTION_PORT', 8082],
  breaker: ['LAB_OVERVIEW_BREAKER_PORT', 8083],
  gateway: ['LAB_OVERVIEW_GATEWAY_PORT', 8084],
  centre: ['LAB_OVERVIEW_CENTRE_PORT', 8085],
  dnp3Gateway: ['LAB_OVERVIEW_DNP3_GATEWAY_PORT', 8086],
  dnp3Centre: ['LAB_OVERVIEW_DNP3_CENTRE_PORT', 8087],
  merging: ['LAB_OVERVIEW_MERGING_PORT', 8088],
  kali: ['LAB_OVERVIEW_KALI_PORT', 6088],
}).map(([name, [key, fallback]]) => {
  const raw = process.env[key] ?? String(fallback);
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
    throw new Error(`${key} must be a valid TCP port`);
  }
  return [name, Number(raw)];
}));
const overviewInputMode = process.env.LAB_OVERVIEW_INPUT_MODE ?? (processInputUrl ? 'http' : 'mms');
if (!['mms', 'http', 'sv'].includes(overviewInputMode) ||
    (overviewInputMode === 'http') !== Boolean(processInputUrl)) {
  throw new Error('Overview input mode must match the configured process input');
}
const overviewChecks = {
  plant: 'http://web-plant:8090/state',
  protection: 'http://web-protection:8090/state',
  breaker: 'http://web-breaker:8090/state',
  gateway: 'http://web-gateway:8090/state',
  centre: 'http://web-control-centre:8090/state',
  dnp3Gateway: 'http://web-gateway-dnp3:8090/state',
  dnp3Centre: 'http://web-control-centre-dnp3:8090/state',
  merging: 'http://web-merging-unit:8090/state',
  kali: 'http://kali-access:6080/vnc.html',
};
const pagePolicy = `default-src 'self'; connect-src 'self' ${captureAgentUrl}; ` +
  "base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const controls = `<div class="station-controls" aria-label="F01 protection and breaker controls">
  <div class="control-heading">Protection and breaker operation</div>
  ${processInputUrl ? `<button type="button" id="reset-protection-trip" disabled>Reset PRF01 trip</button>
  <output id="faceplate-input-status" role="status" aria-live="polite">Waiting for PRF01 current feedback.</output>
  <a id="faceplate-input-link" href="#process-input-panel">Go to current input</a>
  <output id="protection-reset-status" role="status" aria-live="polite"></output>` : ''}
  <button type="button" data-action="reset-latch">Reset BRF01 close latch</button>
  <button type="button" data-action="open">Open</button>
  <button type="button" data-action="close">Close</button>
  <span id="close-guidance"></span>
  <span id="command-result" role="status">No switching command recorded</span>
</div>
<dialog id="command-dialog" class="command-dialog" aria-labelledby="confirmation-title">
  <div class="scada-panel-title"><h2 id="confirmation-title">Confirm switching</h2><span>52-F01</span></div>
  <p id="command-prompt"></p>
  <div class="dialog-actions"><button type="button" id="cancel-command" autofocus>Cancel</button>
  <button type="button" id="confirm-command">Execute</button></div>
</dialog>`;

function processInputControls() {
  if (!processInputUrl) return '';
  return `<section class="scada-panel process-input" id="process-input-panel"
      data-process-input-url="/process-input" data-pickup-a="${protectionPickupA}" aria-labelledby="process-input-title">
    <div class="scada-panel-title"><h2 id="process-input-title">Direct PRF01 process input · HTTP</h2><span>SIMULATION ONLY</span></div>
    <div class="process-input-body">
      <label for="process-current">Selected phase A current <output id="process-current-value">120 A</output></label>
      <input id="process-current" type="range" min="0" max="1200" step="1" value="120">
      <p>PRF01 pickup: <strong>${protectionPickupA} A</strong>. Apply takes control for this tab. Keep it active to renew the input.</p>
      <div class="process-input-actions">
        <button type="button" id="apply-process-current">Apply slider value</button>
        <button type="button" id="run-process-sequence">Run 120 → 250 → 120 A sequence</button>
        <button type="button" id="stop-process-sequence" disabled>Stop sequence · return to 120 A</button>
      </div>
      <output id="process-input-status" role="status" aria-live="polite">No value injected; PRF01 input is invalid until applied.</output>
      <p class="process-input-feedback">Breaker position below is BRF01 contact feedback read over MMS; it is not inferred from the trip command.</p>
    </div>
  </section>`;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }).end(JSON.stringify(body));
}

function isLocalStationRequest(request) {
  const host = request.headers.host ?? '';
  const fetchSite = request.headers['sec-fetch-site'];
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host) &&
    request.headers.origin === 'http://' + host && (!fetchSite || fetchSite === 'same-origin');
}

async function forwardProcessInput(request, response) {
  if (!isLocalStationRequest(request)) {
    sendJson(response, 403, { result: 'ORIGIN REJECTED', code: 'STATION_ORIGIN_REJECTED' });
    return;
  }
  const contentType = request.headers['content-type'];
  if (!/^application\/json(?:\s*;|$)/i.test(contentType ?? '')) {
    sendJson(response, 415, { result: 'JSON REQUIRED' });
    return;
  }
  let length = 0;
  const chunks = [];
  try {
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      length += chunk.length;
      if (length > 1024) {
        sendJson(response, 413, { result: 'BODY TOO LARGE' });
        request.resume();
        return;
      }
      chunks.push(chunk);
    }
  } catch {
    if (!response.destroyed) sendJson(response, 400, { result: 'INCOMPLETE REQUEST' });
    return;
  }
  const owner = request.headers['x-ss01-input-owner'];
  const resetTrip = request.url === '/process-input/reset-trip';
  const takeControl = !resetTrip && request.headers['x-ss01-input-action'] === 'apply';
  if (!/^[a-f0-9-]{36}$/i.test(owner ?? '')) {
    sendJson(response, 409, { result: 'RELOAD STATION AND APPLY CURRENT', code: 'TAB_RELOAD_REQUIRED' });
    return;
  }
  if (!takeControl && owner !== processInputOwner) {
    sendJson(response, 409, { result: 'INPUT CONTROL LOST · APPLY TO TAKE CONTROL', code: 'TAB_CONTROL_LOST' });
    return;
  }
  if (processInputBusy) {
    sendJson(response, 409, { result: 'INPUT BUSY · RETRY', code: 'INPUT_BUSY' });
    return;
  }
  processInputBusy = true;
  try {
    const upstream = await new Promise((resolve, reject) => {
      // Retain PRF01's existing Origin and Host checks across the Compose management network.
      const outgoing = httpRequest(new URL(request.url, processInputUpstream), {
        method: 'POST',
        signal: AbortSignal.timeout(2600),
        headers: {
          Host: processInputUrl.host,
          Origin: request.headers.origin,
          'Content-Type': contentType,
          'Content-Length': length,
        },
      }, resolve);
      outgoing.on('error', reject);
      outgoing.end(Buffer.concat(chunks, length));
    });
    upstream.setEncoding('utf8');
    let body = '';
    for await (const chunk of upstream) body += chunk;
    if (!body && upstream.statusCode === 403) {
      sendJson(response, 403, { result: 'PRF01 REJECTED THE STATION ORIGIN', code: 'PRF01_REJECTED' });
      return;
    }
    const result = JSON.parse(body);
    if (!resetTrip && upstream.statusCode === 200 && result.result === 'APPLIED') {
      appliedProcessCurrent = result.currentA;
      if (takeControl) processInputOwner = owner;
    }
    sendJson(response, upstream.statusCode, upstream.statusCode >= 400
      ? { ...result, code: 'PRF01_REJECTED' } : result);
  } catch (error) {
    const timedOut = error.code === 'ABORT_ERR';
    if (!response.destroyed) sendJson(response, timedOut ? 504 : 502, {
      result: timedOut ? 'PRF01 RESPONSE TIMED OUT' : 'PRF01 CONNECTION UNAVAILABLE',
    });
  } finally {
    processInputBusy = false;
  }
}

const files = new Map([
  ['/', [native ? '../web/native-station.html' : '../web/index.html', 'text/html']],
  ['/station.css', ['../web/station.css', 'text/css']],
  ['/single-line.mjs', ['../web/single-line.mjs', 'text/javascript']],
  ...(native ? [
    ['/native-station.mjs', ['../web/native-station.mjs', 'text/javascript']],
    ['/station-mimic.mjs', ['../web/station-mimic.mjs', 'text/javascript']],
    ['/station-guidance.mjs', ['../web/station-guidance.mjs', 'text/javascript']],
    ['/industrial.css', ['../web/industrial.css', 'text/css']],
    ['/lab-overview', ['../web/lab-overview.html', 'text/html']],
    ['/lab-overview.css', ['../web/lab-overview.css', 'text/css']],
    ['/lab-overview.mjs', ['../web/lab-overview.mjs', 'text/javascript']],
  ] : [
    ['/station.mjs', ['../web/station.mjs', 'text/javascript']],
    ['/yard.mjs', ['../web/yard.mjs', 'text/javascript']],
    ...['classroom', 'feeder', 'ied', 'gateway'].map(name =>
      ['/src/' + name + '.mjs', ['./' + name + '.mjs', 'text/javascript']]),
  ]),
]);

export const server = createServer(async (request, response) => {
  if (native?.controlEnabled && processInputUpstream && request.method === 'POST' &&
      ['/process-input', '/process-input/reset-trip'].includes(request.url)) {
    await forwardProcessInput(request, response);
    return;
  }
  const action = /^\/control\/(open|close|reset-latch)$/.exec(request.url)?.[1];
  if (native?.controlEnabled && action && request.method === 'POST') {
    if (!isLocalStationRequest(request)) {
      sendJson(response, 403, { result: 'ORIGIN REJECTED' });
      return;
    }
    if (processInputUpstream && action !== 'open') {
      const current = native.state().points.current;
      if (current.quality !== 'GOOD' || !Number.isFinite(current.value) || current.value >= protectionPickupA ||
          appliedProcessCurrent >= protectionPickupA) {
        sendJson(response, 409, { result: 'BLOCKED · PRF01 NEEDS VALID CURRENT BELOW PICKUP' });
        return;
      }
    }
    const { status, ...result } = await native.operate(action);
    sendJson(response, status, result);
    return;
  }
  if (native && request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (native && request.url === '/state') {
    sendJson(response, 200, native.state());
    return;
  }
  if (native && request.url === '/plant-indications') {
    let current = null;
    try {
      const upstream = await fetch(overviewChecks.plant, { signal: AbortSignal.timeout(1200), redirect: 'error' });
      if (upstream.ok) {
        const snapshot = await upstream.json();
        if (snapshot.component === 'plant') current = snapshot.points?.current ?? null;
      }
    } catch {
      // Station MMS readings retain their own polling and freshness.
    }
    sendJson(response, 200, { current });
    return;
  }
  if (native && request.url === '/lab-overview/config') {
    sendJson(response, 200, { ports: overviewPorts, inputMode: overviewInputMode, captureAgentUrl });
    return;
  }
  if (native && request.url === '/lab-overview/reachability') {
    const results = await Promise.all(Object.entries(overviewChecks).map(async ([name, url]) => {
      try {
        const result = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: 'manual' });
        return [name, result.ok];
      } catch {
        return [name, false];
      }
    }));
    sendJson(response, 200, { checkedAt: Date.now(), pages: Object.fromEntries(results) });
    return;
  }
  const entry = files.get(request.url);
  if (!entry) {
    response.writeHead(404).end();
    return;
  }
  try {
    const [file, type] = entry;
    const body = await readFile(new URL(file, import.meta.url), 'utf8');
    const headers = { 'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
    if (type === 'text/html' && native) headers['Content-Security-Policy'] = pagePolicy;
    const stationPage = type === 'text/html' && native?.controlEnabled;
    const page = stationPage ? body
      .replace('MMS MONITORING · READ ONLY', 'MMS MONITORING AND CONTROL')
      .replace('<!-- STATION_CONTROLS -->', controls)
      .replace('<!-- PROCESS_INPUT_PANEL -->', processInputControls()) : body;
    response.writeHead(200, headers).end(page);
  } catch {
    response.writeHead(500).end();
  }
});

const bindAddress = process.env.LAB_HMI_BIND_ADDRESS || '127.0.0.1';
server.listen(process.env.PORT || 8080, bindAddress, () => {
  console.log((native ? 'Native MMS station HMI' : 'Station HMI') + ': http://' + bindAddress + ':' + server.address().port);
});
if (native) {
  server.once('close', () => native.stop());
  server.once('error', error => {
    native.stop();
    process.exitCode = 1;
    console.error('Station HMI:', error.message);
  });
  process.once('SIGINT', () => server.close());
  process.once('SIGTERM', () => server.close());
  if (process.send) process.once('disconnect', () => server.close());
}
