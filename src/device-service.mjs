import { createServer } from 'node:http';
import { Feeder } from './feeder.mjs';
import { Ied } from './ied.mjs';

const role = process.argv[2];
const ports = { feeder: 8201, ied: 8202, gateway: 8203, supervisory: 8204 };
if (!Object.hasOwn(ports, role)) throw new Error('Choose feeder, ied, gateway or supervisory');
const basePort = Number(process.env.DEVICE_BASE_PORT ?? 8200);

async function exchange(target, path, data) {
  const response = await fetch('http://127.0.0.1:' + (basePort + ports[target] - 8200) + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(1000),
  });
  if (!response.ok) throw new Error(target + ' returned HTTP ' + response.status);
  return response.json();
}

function feederService() {
  const feeder = new Feeder();
  return {
    read: () => feeder.read(),
    apply({ action, active }) {
      if (action === 'fault' && typeof active === 'boolean') feeder.setFault(active);
      else if (action === 'open') feeder.operate(false);
      else if (action === 'close') {
        if (feeder.read().fault) return { accepted: false, reason: 'Active fault' };
        feeder.operate(true);
      } else return { accepted: false, reason: 'Unknown process action' };
      return { accepted: true };
    },
  };
}

function iedService() {
  let feedback;
  let operation;
  const ied = new Ied({ read: () => feedback, operate: closed => { operation = closed ? 'close' : 'open'; } });
  let tail = Promise.resolve();

  function serialize(work) {
    const next = tail.then(work);
    tail = next.catch(() => {});
    return next;
  }

  async function refresh() {
    operation = undefined;
    feedback = await exchange('feeder', '/state');
    ied.evaluateProtection();
    if (operation) {
      await exchange('feeder', '/action', { action: operation });
      feedback = await exchange('feeder', '/state');
    }
  }

  let polling = false;
  const timer = setInterval(async () => {
    if (polling) return;
    polling = true;
    try { await serialize(refresh); }
    catch { /* Retry when the process service is reachable again. */ }
    finally { polling = false; }
  }, 250);
  timer.unref();

  return {
    read: () => serialize(async () => {
      await refresh();
      return { ...ied.read(), sampledAt: new Date().toISOString() };
    }),
    apply: data => serialize(async () => {
      await refresh();
      if (data.action === 'mode' && ['LOCAL', 'REMOTE'].includes(data.mode)) {
        ied.setMode(data.mode);
        return { accepted: true };
      }
      operation = undefined;
      const result = ied.command(data.origin, data.action);
      if (result.accepted && operation) return exchange('feeder', '/action', { action: operation });
      return result;
    }),
  };
}

function gatewayService() {
  let connected = true;
  let linkEpoch = 0;
  let lastSample = null;
  return {
    async read() {
      if (connected) {
        const epoch = linkEpoch;
        try {
          const sample = await exchange('ied', '/state');
          if (epoch === linkEpoch) {
            lastSample = sample;
            return { connected, quality: 'LIVE', sample };
          }
        } catch {
          // Retain the last good sample if the station service is unavailable.
        }
      }
      return { connected, quality: lastSample ? 'STALE' : 'UNKNOWN', sample: lastSample };
    },
    apply({ action, available }) {
      if (action !== 'link' || typeof available !== 'boolean') {
        return { accepted: false, reason: 'Unknown gateway action' };
      }
      connected = available;
      linkEpoch++;
      return { accepted: true };
    },
  };
}

function supervisoryService() {
  let lastSample = null;
  async function read() {
    try {
      const result = await exchange('gateway', '/state');
      if (result.quality === 'LIVE') {
        lastSample = result.sample;
        return { quality: 'LIVE', sample: lastSample };
      }
    } catch {
      // A gateway process outage also invalidates the current indication.
    }
    return { quality: lastSample ? 'STALE' : 'UNKNOWN', sample: lastSample };
  }
  setInterval(() => read(), 500).unref();
  return { read };
}

const factories = { feeder: feederService, ied: iedService, gateway: gatewayService, supervisory: supervisoryService };
const service = factories[role]();
const ids = { feeder: '52-F01', ied: 'PR-F01', gateway: 'GW-01', supervisory: 'CC-01' };
const title = { feeder: 'Feeder process', ied: 'Protection IED', gateway: 'Station gateway', supervisory: 'Control centre' };
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${ids[role]} · ${title[role]}</title>
<style>
body{margin:0;background:#d6dcdf;color:#202a31;font:14px "Segoe UI",sans-serif}header{background:#26343d;color:#fff;padding:12px 16px;font-weight:700}main{padding:12px;max-width:850px}table{width:100%;border-collapse:collapse;font:14px Consolas,monospace}th,td{text-align:left;padding:7px 9px;border:1px solid #9ba8ae}thead{background:#485963;color:#fff}tbody tr:nth-child(even){background:#e4e8ea}.stale{background:#f3d99d;font-weight:bold}p{font-size:13px}
</style><header>${ids[role]} / ${title[role].toUpperCase()}</header>
<main><table><thead><tr><th>Point</th><th>Value</th></tr></thead><tbody id="points"></tbody></table>
<p id="status" role="status">Waiting for device service</p></main>
<script>
const points = document.getElementById('points');
const status = document.getElementById('status');
const names = {
  position:'Breaker position', busVoltageKv:'Bus voltage (kV)', feederCurrentA:'Feeder current (A)',
  fault:'Physical fault', tripLatched:'Trip latch', mode:'Control authority',
  sampledAt:'Source timestamp (UTC)', quality:'Data quality', connected:'WAN enabled'
};
async function refresh() {
  try {
    const response = await fetch('/state', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const state = await response.json();
    const rows = Object.entries(state).flatMap(([key, value]) =>
      key === 'sample' ? Object.entries(value || {}) : [[key, value]]);
    points.replaceChildren(...rows.map(([key, value]) => {
      const row = document.createElement('tr');
      row.insertCell().textContent = names[key] || key;
      const cell = row.insertCell();
      cell.textContent = value === true ? 'YES' : value === false ? 'NO' : value;
      if (value === 'STALE') cell.className = 'stale';
      return row;
    }));
    status.textContent = 'Connected to local device service';
  } catch {
    points.replaceChildren();
    status.textContent = 'Device data unavailable';
  } finally {
    setTimeout(refresh, 500);
  }
}
refresh();
</script></html>`;

const server = createServer(async (request, response) => {
  function send(status, content, type = 'application/json') {
    response.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(type === 'application/json' ? JSON.stringify(content) : content);
  }

  try {
    if (request.method === 'GET' && request.url === '/') return send(200, page, 'text/html');
    if (request.method === 'GET' && request.url === '/state') return send(200, await service.read());
    if (request.method === 'POST' && request.url === '/action' && service.apply) {
      if (request.headers.origin || request.headers['content-type'] !== 'application/json') {
        return send(403, { error: 'Use the local lab CLI for actions' });
      }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 4096) return send(413, { error: 'Action body too large' });
      }
      let data;
      try { data = JSON.parse(body); } catch { return send(400, { error: 'Invalid JSON' }); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return send(400, { error: 'Expected an action object' });
      return send(200, await service.apply(data));
    }
    return send(404, { error: 'Unknown route' });
  } catch {
    return send(503, { error: 'Device data unavailable' });
  }
});
server.listen(basePort + ports[role] - 8200, '127.0.0.1', () => {
  console.log(ids[role] + ' http://127.0.0.1:' + server.address().port);
});
