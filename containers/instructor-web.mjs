import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recentHistory } from './instructor-history.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const history = fileURLToPath(new URL('../outputs/instructor-history.jsonl', import.meta.url));
const script = fileURLToPath(new URL('./instructor.mjs', import.meta.url));
const allowed = new Set(['fault', 'clear', 'stuck', 'stall', 'contacts-invalid', 'normal', 'gateway-stop', 'gateway-start', 'reset']);
const port = Number(process.env.LAB_INSTRUCTOR_PORT || 8091);
let active = null;
let last = null;

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SS-01 Instructor</title><style>
body{margin:0;background:#d4d9db;color:#17282e;font:15px Arial,sans-serif}header{background:#263b43;color:white;padding:16px 24px;border-bottom:5px solid #dbad36}main{max-width:980px;margin:24px auto;padding:0 16px}.panel{background:#eef1f1;border:1px solid #879499;margin-bottom:16px}.title{background:#52666d;color:white;padding:10px 14px;font-weight:bold}.content{padding:16px}button{min-width:145px;padding:12px;margin:4px;background:#d9e0e1;border:1px solid #6b7c80;color:#17282e;font-weight:bold;cursor:pointer}button:hover{background:#c4d3d5}button:disabled{opacity:.5}button[data-action=reset]{background:#e8d28b}pre{white-space:pre-wrap;background:#fff;border:1px solid #aab5b7;padding:12px;min-height:60px}table{width:100%;border-collapse:collapse;background:white}td,th{border:1px solid #aab5b7;text-align:left;padding:7px}th{background:#d6dedf}</style></head>
<body><header><strong>SS-01</strong> &nbsp; Instructor console &nbsp; / &nbsp; Feeder F01</header><main><section class="panel"><div class="title">Scenario controls</div><div class="content"><button data-action="fault">Apply fault</button><button data-action="clear">Clear fault</button><button data-action="stuck">Stuck breaker</button><button data-action="stall">Stall movement</button><button data-action="contacts-invalid">Invalid contacts</button><button data-action="normal">Normal mechanism</button><button data-action="gateway-stop">Stop IEC 104 gateway</button><button data-action="gateway-start">Start IEC 104 gateway</button><button data-action="reset">Reset baseline</button></div></section><section class="panel"><div class="title">Command status</div><div class="content"><div id="status" role="status">Ready</div><pre id="output"></pre></div></section><section class="panel"><div class="title">Recent instructor actions</div><div class="content"><table><thead><tr><th>Started (UTC)</th><th>Action</th><th>Result</th><th>Detail</th></tr></thead><tbody id="history"></tbody></table></div></section></main><script>
async function refresh(){const s=await(await fetch('/api/state')).json();document.querySelector('#status').textContent=s.active?'Running '+s.active:s.last?s.last.action+' — '+s.last.result:'Ready';document.querySelector('#output').textContent=s.last?.output||'';document.querySelectorAll('button').forEach(b=>b.disabled=!!s.active);const tbody=document.querySelector('#history');tbody.replaceChildren();for(const item of s.history.slice().reverse()){const tr=document.createElement('tr');for(const x of [item.startedAt,item.action,item.result,item.detail||'']){const td=document.createElement('td');td.textContent=x;tr.append(td)}tbody.append(tr)}}
document.addEventListener('click',async e=>{const action=e.target.dataset.action;if(!action)return;if(!confirm('Execute '+action+' on the selected training stack?'))return;const response=await fetch('/api/action/'+action,{method:'POST'});if(!response.ok)document.querySelector('#status').textContent=await response.text();await refresh()});refresh();setInterval(refresh,1500);
</script></body></html>`;

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
}

createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" }).end(page);
    return;
  }
  if (request.method === 'GET' && request.url === '/api/state') {
    let records;
    try {
      records = await recentHistory(history, process.env.COMPOSE_PROJECT_NAME || 'ss01-bench');
    } catch (error) {
      console.error('Cannot read instructor history:', error);
      json(response, 500, { error: 'Cannot read instructor history' });
      return;
    }
    json(response, 200, { active, last, history: records });
    return;
  }
  const action = /^\/api\/action\/([a-z-]+)$/.exec(request.url)?.[1];
  if (request.method === 'POST' && allowed.has(action)) {
    if (request.headers.origin !== `http://${request.headers.host}` ||
        !/^(127\.0\.0\.1|localhost):\d+$/.test(request.headers.host || '')) {
      json(response, 403, { error: 'Origin rejected' });
      return;
    }
    if (active) { json(response, 409, { error: 'Another action is running' }); return; }
    active = action;
    const child = spawn(process.execPath, [script, action], { cwd: root, env: process.env, windowsHide: true });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-12000); });
    child.on('error', error => { last = { action, output: error.message, result: 'failed' }; active = null; });
    child.on('close', code => { last = { action, output, result: code === 0 ? 'success' : 'failed' }; active = null; });
    json(response, 202, { action });
    return;
  }
  json(response, 404, { error: 'Not found' });
}).listen(port, '127.0.0.1', () => console.log(`Instructor console: http://127.0.0.1:${port}`));
