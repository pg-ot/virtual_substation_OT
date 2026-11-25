const byId = id => document.getElementById(id);
const modes = {
  mms: ['Plant MMS', 'SIMF01 supplies the default process measurement to PRF01.'],
  http: ['Direct HTTP simulation input', 'The station browser sends simulated phase-A current to PRF01. This is not an IEC 61850 process-bus protocol.'],
  sv: ['Experimental Sampled Values', 'MUF01 publishes the experimental SV stream. Continuity and timing are not guaranteed.'],
};
let captureAgent;
let captureTargets = [];
let captureJob;
let captureBusy = false;
let captureVerified = false;

function updateMmsCommand() {
  const capture = captureJob?.status === 'running' && captureJob.captures.find(item =>
    item.service === 'station-hmi' && item.network === 'station' && item.status === 'running');
  const target = capture && captureTargets.find(item => item.service === capture.service &&
    item.network === capture.network && item.interface === capture.interface && item.address === capture.address);
  const container = target?.id?.match(/^([a-f0-9]{64}):/);
  byId('capture-mms-command').textContent = container
    ? `Instructor on Docker host: docker exec ${container[1]} station-client read`
    : 'The command appears when a running capture includes the station-hmi station interface.';
}

async function getJson(path) {
  const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function configure() {
  try {
    const config = await getJson('/lab-overview/config');
    for (const link of document.querySelectorAll('[data-asset]')) {
      const port = config.ports[link.dataset.asset];
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid asset port');
      link.href = `http://127.0.0.1:${port}${link.dataset.path || '/'}`;
    }
    const mode = modes[config.inputMode];
    if (!mode) throw new Error('Unknown input profile');
    byId('input-mode').textContent = mode[0];
    byId('input-description').textContent = mode[1];
    byId('route-input').textContent = mode[0];
    if (config.captureAgentUrl) {
      const url = new URL(config.captureAgentUrl);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' ||
          url.username || url.password || url.search || url.hash) throw new Error('Invalid capture agent URL');
      captureAgent = url.origin;
      await refreshCaptureTargets();
    } else {
      byId('capture-status').textContent = 'Capture agent is not configured for this station.';
      byId('capture-overview-note').textContent = 'Capture agent is not configured for this station.';
    }
  } catch (error) {
    byId('input-mode').textContent = 'Configuration unavailable';
    byId('input-description').textContent = 'Asset links and input profile could not be loaded. Reload to retry.';
    console.error('Lab overview configuration:', error);
  }
}

async function captureRequest(path, body) {
  const response = await fetch(captureAgent + path, {
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    cache: 'no-store', signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

function updateCaptureControls() {
  const scope = byId('capture-scope').value;
  const select = byId('capture-target');
  const previous = select.value;
  select.replaceChildren();
  if (scope === 'lab') select.add(new Option('All available networks', ''));
  else if (scope === 'network') {
    for (const network of [...new Set(captureTargets.map(target => target.network))]) {
      select.add(new Option(network.toUpperCase(), network));
    }
  } else {
    for (const target of captureTargets) {
      select.add(new Option(`${target.service} / ${target.network} / ${target.interface} (${target.address})`, target.id));
    }
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
  const running = captureJob && !['complete', 'completed with errors'].includes(captureJob.status);
  select.disabled = scope === 'lab' || captureBusy || running;
  byId('capture-scope').disabled = captureBusy || running;
  byId('capture-duration').disabled = captureBusy || running;
  byId('capture-refresh').disabled = captureBusy || running;
  byId('capture-start').disabled = !captureVerified || captureBusy || running || !captureTargets.length || (scope !== 'lab' && !select.value);
  byId('capture-stop').disabled = !captureVerified || captureBusy || captureJob?.status !== 'running';
}

function showCapture(job) {
  captureJob = job;
  byId('capture-status').textContent = `Capture ${job.id}: ${job.status}. ${job.captures.length} interface(s).` +
    (job.errors.length ? ` ${job.errors.join('; ')}` : '');
  const files = byId('capture-files');
  files.replaceChildren();
  for (const file of job.files) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `${captureAgent}/lab-capture/download/${job.id}/${encodeURIComponent(file)}`;
    link.textContent = file;
    item.append(link);
    files.append(item);
  }
  updateMmsCommand();
  updateCaptureControls();
  if (!['complete', 'completed with errors'].includes(job.status)) {
    setTimeout(async () => {
      try { showCapture(await captureRequest(`/lab-capture/status/${job.id}`)); }
      catch (error) {
        byId('capture-status').textContent = `Capture status unavailable: ${error.message}`;
        console.error('Capture status:', error);
      }
    }, 1500);
  }
}

async function refreshCaptureTargets() {
  captureBusy = true;
  updateCaptureControls();
  try {
    const result = await captureRequest('/lab-capture/targets');
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(result.project ?? '') ||
        typeof result.station !== 'string' ||
        (location.origin !== captureAgent && result.station !== location.origin)) {
      throw new Error('Capture agent is not verified for this station');
    }
    captureVerified = true;
    captureTargets = result.targets;
    const link = byId('capture-overview-link');
    link.href = `${captureAgent}/lab-overview`;
    link.hidden = false;
    byId('capture-overview-note').textContent = `Agent project: ${result.project}. Confirm this is your disposable training project.`;
    byId('capture-status').textContent = `${result.project}: ${captureTargets.length} project interfaces available.`;
    if (result.active || result.recent) showCapture(result.active || result.recent);
  } catch (error) {
    captureVerified = false;
    captureTargets = [];
    byId('capture-overview-link').hidden = true;
    byId('capture-overview-note').textContent = 'Capture agent unavailable or not verified for this station.';
    byId('capture-status').textContent = 'Capture agent unavailable or not verified. Start the host capture agent for this station and project.';
    updateMmsCommand();
    console.error('Capture agent:', error);
  } finally {
    captureBusy = false;
    updateCaptureControls();
  }
}

byId('capture-scope').addEventListener('change', updateCaptureControls);
byId('capture-refresh').addEventListener('click', refreshCaptureTargets);
byId('capture-start').addEventListener('click', async () => {
  captureBusy = true;
  updateCaptureControls();
  byId('capture-status').textContent = 'Starting captures…';
  try {
    showCapture(await captureRequest('/lab-capture/start', {
      scope: byId('capture-scope').value, target: byId('capture-target').value,
      seconds: Number(byId('capture-duration').value),
    }));
  } catch (error) {
    byId('capture-status').textContent = `Capture could not start: ${error.message}`;
    console.error('Capture start:', error);
  } finally {
    captureBusy = false;
    updateCaptureControls();
  }
});
byId('capture-stop').addEventListener('click', async () => {
  captureBusy = true;
  updateCaptureControls();
  try { showCapture(await captureRequest('/lab-capture/stop', { id: captureJob.id })); }
  catch (error) {
    byId('capture-status').textContent = `Capture stop failed: ${error.message}`;
    console.error('Capture stop:', error);
  } finally {
    captureBusy = false;
    updateCaptureControls();
  }
});

async function refreshPages() {
  try {
    const result = await getJson('/lab-overview/reachability');
    for (const status of document.querySelectorAll('[data-status]')) {
      const available = result.pages[status.dataset.status];
      status.textContent = available ? 'Endpoint reachable' : 'Endpoint unavailable / not running';
      status.classList.toggle('reachable', available);
      status.classList.toggle('unavailable', !available);
    }
    byId('check-time').textContent = `Endpoints checked ${new Date(result.checkedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
  } catch (error) {
    for (const status of document.querySelectorAll('[data-status]')) {
      status.textContent = 'Endpoint status unknown';
      status.classList.remove('reachable', 'unavailable');
    }
    byId('check-time').textContent = 'Endpoint checks unavailable; retrying.';
    console.error('Lab overview page checks:', error);
  } finally {
    setTimeout(refreshPages, 15000);
  }
}

function reading(point, value) {
  if (!point) return 'UNKNOWN';
  const time = Number.isFinite(point.sourceTimeMs)
    ? new Date(point.sourceTimeMs).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    : 'no source time';
  return `${point.quality === 'GOOD' ? value : 'UNKNOWN'} · ${point.quality} · ${time}`;
}

async function refreshReadings() {
  try {
    const state = await getJson('/state');
    byId('reader-status').textContent = `Station MMS reader: ${state.reader}`;
    byId('reading-position').textContent = reading(state.points.position, state.points.position?.value);
    byId('reading-trip').textContent = reading(state.points.trip, state.points.trip?.value ? 'ASSERTED' : 'CLEAR');
    byId('reading-current').textContent = reading(state.points.current,
      Number.isFinite(state.points.current?.value) ? `${state.points.current.value.toFixed(1)} A` : 'UNKNOWN');
  } catch (error) {
    byId('reader-status').textContent = 'Station MMS reader status unavailable';
    for (const id of ['reading-position', 'reading-trip', 'reading-current']) byId(id).textContent = 'UNKNOWN';
    console.error('Lab overview readings:', error);
  } finally {
    setTimeout(refreshReadings, 3000);
  }
}

configure();
refreshPages();
refreshReadings();
