import { execFile, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const [project, hmiPortText, agentPortText, ...extra] = process.argv.slice(2);
const port = text => /^\d+$/.test(text ?? '') && Number(text) > 0 && Number(text) <= 65535;
if (!/^[a-z0-9][a-z0-9_-]*$/.test(project ?? '') || !port(hmiPortText) || !port(agentPortText) || extra.length) {
  throw new Error('Usage: node containers/capture-agent.mjs <compose-project> <hmi-port> <capture-port>');
}
const hmiOrigin = `http://127.0.0.1:${hmiPortText}`;
const origin = `http://127.0.0.1:${agentPortText}`;
const root = fileURLToPath(new URL('../', import.meta.url));
const captureRoot = join(root, 'outputs', 'captures');
const docker = promisify(execFile);
const image = 'ss01-kali:dev';
const allowedNetworks = new Set(['station', 'process', 'supervisory', 'management']);
const validFile = file => /^(?:\d{2}-[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]+-[a-zA-Z0-9_.-]+\.pcap|combined\.pcapng|manifest\.json)$/.test(file);
const jobs = new Map();
let active;

async function command(...args) {
  const { stdout } = await docker('docker', args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

async function discover() {
  const list = await command('ps', '-q', '--filter', `label=com.docker.compose.project=${project}`);
  if (!list) throw new Error(`No running containers found for project ${project}`);
  const ids = list.split(/\s+/);
  const containers = JSON.parse(await command('inspect', ...ids));
  const targets = [];
  for (const container of containers) {
    const labels = container.Config.Labels ?? {};
    if (labels['com.docker.compose.project'] !== project ||
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(labels['com.docker.compose.service'] ?? '')) continue;
    const candidates = Object.entries(container.NetworkSettings.Networks ?? {})
      .filter(([name, network]) => allowedNetworks.has(name.slice(project.length + 1)) &&
        name.startsWith(`${project}_`) && network.IPAddress);
    if (!candidates.length) continue;
    const interfaces = JSON.parse(await command('run', '--rm', '--network', `container:${container.Id}`,
      '--entrypoint', 'ip', image, '-j', '-4', 'addr', 'show'));
    for (const [name, network] of candidates) {
      const iface = interfaces.find(item => item.addr_info?.some(address => address.local === network.IPAddress));
      if (!iface || !/^[a-zA-Z0-9_.-]+$/.test(iface.ifname)) {
        throw new Error(`Cannot map ${labels['com.docker.compose.service']} ${name} to an interface`);
      }
      targets.push({
        id: `${container.Id}:${name}`,
        container: container.Id,
        service: labels['com.docker.compose.service'],
        network: name.slice(project.length + 1),
        interface: iface.ifname,
        address: network.IPAddress,
      });
    }
  }
  if (!targets.length) throw new Error('No supported project network interfaces found');
  return targets.sort((a, b) => a.network.localeCompare(b.network) || a.service.localeCompare(b.service));
}

function publicJob(job) {
  return {
    id: job.id, project, status: job.status, scope: job.scope, seconds: job.seconds, startedAt: job.startedAt,
    finishedAt: job.finishedAt, errors: job.errors, files: job.files,
    captures: job.captures.map(({ service, network, interface: iface, address, file, status, detail, startedAt, finishedAt }) =>
      ({ service, network, interface: iface, address, file, status, detail, startedAt, finishedAt })),
  };
}

function startCapture(job, target, index) {
  const name = `ss01-cap-${job.id}-${index}`;
  const file = `${String(index + 1).padStart(2, '0')}-${target.service}-${target.network}-${target.interface}.pcap`;
  const capture = { ...target, name, file, status: 'starting', detail: '' };
  job.captures.push(capture);
  const args = ['run', '--init', '--rm', '--name', name, '--network', `container:${target.container}`,
    '--cap-drop', 'ALL', '--cap-add', 'NET_RAW', '--cap-add', 'CHOWN', '--cap-add', 'SETUID',
    '--cap-add', 'SETGID', '--cap-add', 'KILL', '--mount', `type=bind,src=${job.directory},dst=/captures`,
    '--entrypoint', 'timeout', image, '--signal=INT', String(job.seconds), 'tcpdump', '-p',
    '-i', target.interface, '-s', '0', '-U', '-c', '10000', '-w', `/captures/${file}`];
  const child = spawn('docker', args, { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  let output = '';
  let started = false;
  let settleReady;
  const ready = new Promise((resolveReady, rejectReady) => { settleReady = { resolveReady, rejectReady }; });
  const readyTimeout = setTimeout(() => {
    if (!started) settleReady.rejectReady(new Error(`Capture did not start: ${name}`));
  }, 20000);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    output = (output + chunk).slice(-16000);
    if (!started && output.includes('listening on')) {
      started = true;
      clearTimeout(readyTimeout);
      capture.status = 'running';
      capture.startedAt = new Date().toISOString();
      settleReady.resolveReady();
    }
  });
  const completed = new Promise(resolveDone => {
    child.once('error', error => {
      clearTimeout(readyTimeout);
      capture.detail = error.message;
      capture.status = 'failed';
      if (!started) settleReady.rejectReady(error);
      resolveDone();
    });
    child.once('close', code => {
      clearTimeout(readyTimeout);
      capture.detail = output.trim();
      capture.finishedAt = new Date().toISOString();
      capture.status = started && (code === 0 || code === 124 || (job.stopping && [130, 143].includes(code)))
        ? 'complete' : 'failed';
      if (!started) settleReady.rejectReady(new Error(output.trim() || `Capture exited ${code}`));
      resolveDone();
    });
  });
  return { ready, completed };
}

async function finish(job, completions) {
  await Promise.all(completions);
  for (const capture of job.captures) {
    if (capture.status === 'failed') job.errors.push(`${capture.service}/${capture.network}: ${capture.detail}`);
    else {
      try {
        if ((await stat(join(job.directory, capture.file))).size >= 24) job.files.push(capture.file);
        else job.errors.push(`${capture.file}: incomplete capture file`);
      } catch (error) {
        job.errors.push(`${capture.file}: ${error.message}`);
      }
    }
  }
  if (job.files.length > 1) {
    try {
      await command('run', '--rm', '--network', 'none', '--mount',
        `type=bind,src=${job.directory},dst=/captures`, '--entrypoint', 'mergecap', image,
        '-w', '/captures/combined.pcapng', ...job.files.map(file => `/captures/${file}`));
      job.files.unshift('combined.pcapng');
    } catch (error) {
      job.errors.push(`Merge failed: ${error.message}`);
    }
  }
  job.finishedAt = new Date().toISOString();
  job.status = job.errors.length ? 'completed with errors' : 'complete';
  try {
    job.files.push('manifest.json');
    await writeFile(join(job.directory, 'manifest.json'), JSON.stringify(publicJob(job), null, 2) + '\n');
  } catch (error) {
    job.files = job.files.filter(file => file !== 'manifest.json');
    job.errors.push(`Manifest write failed: ${error.message}`);
    job.status = 'completed with errors';
  }
  if (active === job) active = undefined;
}

async function begin(body) {
  if (active) throw new Error('A capture is already in progress');
  if (!['interface', 'network', 'lab'].includes(body.scope) ||
      ![10, 30, 60].includes(body.seconds) || typeof body.target !== 'string') {
    throw new Error('Invalid capture scope, target or duration');
  }
  const id = randomBytes(8).toString('hex');
  const job = { id, scope: body.scope, seconds: body.seconds, status: 'starting',
    startedAt: new Date().toISOString(), errors: [], files: [], captures: [],
    directory: join(captureRoot, id), stopping: false };
  active = job;
  jobs.set(id, job);
  try {
    const targets = await discover();
    const selected = targets.filter(target => body.scope === 'lab' ||
      (body.scope === 'network' ? target.network === body.target : target.id === body.target));
    if (!selected.length || selected.length > 32) throw new Error('Capture selection is unavailable or too large');
    await mkdir(captureRoot, { recursive: true });
    await mkdir(job.directory);
    const captures = selected.map((target, index) => startCapture(job, target, index));
    const completions = captures.map(capture => capture.completed);
    try {
      await Promise.all(captures.map(capture => capture.ready));
      job.status = 'running';
    } catch (error) {
      job.errors.push(`Capture startup: ${error.message}`);
      job.stopping = true;
      await Promise.allSettled(job.captures.map(capture => command('stop', '--timeout', '5', capture.name)));
      await finish(job, completions);
      return publicJob(job);
    }
    void finish(job, completions).catch(error => {
      job.errors.push(`Finalization failed: ${error.message}`);
      job.status = 'completed with errors';
      if (active === job) active = undefined;
      console.error(error);
    });
    return publicJob(job);
  } catch (error) {
    jobs.delete(id);
    active = undefined;
    throw error;
  }
}

function send(response, status, body, request) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' };
  if ([origin, hmiOrigin].includes(request.headers.origin)) {
    headers['Access-Control-Allow-Origin'] = request.headers.origin;
    headers.Vary = 'Origin';
  }
  response.writeHead(status, headers).end(JSON.stringify(body));
}

async function bodyJson(request) {
  if (request.headers['content-type'] !== 'application/json') throw new Error('Expected application/json');
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) throw new Error('Request too large');
  }
  return JSON.parse(body);
}

const assets = new Map([
  ['/lab-overview', ['web/lab-overview.html', 'text/html']],
  ['/station.css', ['web/station.css', 'text/css']],
  ['/industrial.css', ['web/industrial.css', 'text/css']],
  ['/lab-overview.css', ['web/lab-overview.css', 'text/css']],
  ['/lab-overview.mjs', ['web/lab-overview.mjs', 'text/javascript']],
]);
const server = createServer(async (request, response) => {
  try {
    if (request.headers.host !== `127.0.0.1:${agentPortText}` ||
        (request.headers.origin && ![origin, hmiOrigin].includes(request.headers.origin))) {
      send(response, 403, { error: 'Origin or host rejected' }, request);
      return;
    }
    if (request.method === 'OPTIONS' && request.url.startsWith('/lab-capture/')) {
      response.writeHead(204, { 'Access-Control-Allow-Origin': request.headers.origin,
        'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'content-type', Vary: 'Origin' }).end();
      return;
    }
    if (request.method === 'POST' && request.url.startsWith('/lab-capture/')) {
      if (![origin, hmiOrigin].includes(request.headers.origin)) {
        send(response, 403, { error: 'Origin required' }, request);
        return;
      }
      if (request.url === '/lab-capture/start') {
        const job = await begin(await bodyJson(request));
        send(response, job.status === 'running' ? 202 : 500,
          job.status === 'running' ? job : { error: job.errors.join('; '), job }, request);
        return;
      }
      if (request.url === '/lab-capture/stop') {
        const body = await bodyJson(request);
        if (!active || active.id !== body.id || active.status !== 'running') throw new Error('Capture is not running');
        const job = active;
        job.stopping = true;
        const results = await Promise.allSettled(job.captures.filter(item => item.status === 'running')
          .map(item => command('stop', '--timeout', '5', item.name)));
        for (const result of results) if (result.status === 'rejected') job.errors.push(`Stop failed: ${result.reason.message}`);
        send(response, 200, publicJob(job), request);
        return;
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, { error: 'Method not allowed' }, request);
      return;
    }
    if (request.url === '/lab-capture/targets') {
      const recent = [...jobs.values()].filter(job => job.status === 'complete' || job.status === 'completed with errors')
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      send(response, 200, { project, station: hmiOrigin, targets: await discover(), active: active ? publicJob(active) : null,
        recent: recent ? publicJob(recent) : null }, request);
      return;
    }
    const statusMatch = /^\/lab-capture\/status\/([a-f0-9]{16})$/.exec(request.url);
    if (statusMatch && jobs.has(statusMatch[1])) {
      send(response, 200, publicJob(jobs.get(statusMatch[1])), request);
      return;
    }
    const download = /^\/lab-capture\/download\/([a-f0-9]{16})\/([a-zA-Z0-9_.-]+)$/.exec(request.url);
    if (download && jobs.get(download[1])?.files.includes(download[2])) {
      const file = join(jobs.get(download[1]).directory, download[2]);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${download[2]}"`, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).on('error', error => response.destroy(error)).pipe(response);
      return;
    }
    if (['/state', '/lab-overview/config', '/lab-overview/reachability'].includes(request.url)) {
      const upstream = await fetch(hmiOrigin + request.url, { signal: AbortSignal.timeout(5000) });
      if (!upstream.ok) throw new Error(`Station HMI returned ${upstream.status}`);
      const data = await upstream.json();
      if (request.url === '/lab-overview/config') data.captureAgentUrl = origin;
      send(response, 200, data, request);
      return;
    }
    const asset = assets.get(request.url);
    if (asset) {
      let data = await readFile(resolve(root, asset[0]), 'utf8');
      if (request.url === '/lab-overview') data = data.replaceAll('href="/"', `href="${hmiOrigin}/"`);
      response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`,
        'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        'X-Content-Type-Options': 'nosniff' }).end(request.method === 'HEAD' ? '' : data);
      return;
    }
    send(response, 404, { error: 'Not found' }, request);
  } catch (error) {
    console.error('Capture agent:', error.message);
    if (!response.headersSent) send(response, 400, { error: error.message }, request);
    else response.destroy(error);
  }
});

await mkdir(captureRoot, { recursive: true });
for (const entry of await readdir(captureRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^[a-f0-9]{16}$/.test(entry.name)) continue;
  const directory = join(captureRoot, entry.name);
  try {
    const saved = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    if (saved.id !== entry.name || saved.project !== project ||
        !['complete', 'completed with errors'].includes(saved.status) ||
        !Array.isArray(saved.files) || !saved.files.every(file => typeof file === 'string' && validFile(file)) ||
        !Array.isArray(saved.captures) || !Array.isArray(saved.errors) || typeof saved.startedAt !== 'string') continue;
    jobs.set(saved.id, { ...saved, directory });
  } catch (error) {
    console.error(`Cannot read capture manifest ${entry.name}: ${error.message}`);
  }
}
server.listen(Number(agentPortText), '127.0.0.1', () =>
  console.log(`Capture overview: ${origin}/lab-overview (project ${project}, station ${hmiOrigin})`));
