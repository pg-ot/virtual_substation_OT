import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const assets = new Map([
  ['/yard/', ['index.html', 'text/html; charset=utf-8']],
  ['/yard/yard.css', ['yard.css', 'text/css; charset=utf-8']],
  ['/yard/view.mjs', ['view.mjs', 'text/javascript; charset=utf-8']],
  ['/yard/telemetry.mjs', ['telemetry.mjs', 'text/javascript; charset=utf-8']],
  ['/yard/yard.js', ['runtime/yard.js', 'text/javascript; charset=utf-8']],
  ['/yard/yard.pck', ['runtime/yard.pck', 'application/octet-stream']],
  ['/yard/yard.wasm', ['runtime/yard.wasm.gz', 'application/wasm']],
  ['/yard/yard.audio.worklet.js', ['runtime/yard.audio.worklet.js', 'text/javascript; charset=utf-8']],
  ['/yard/yard.audio.position.worklet.js', ['runtime/yard.audio.position.worklet.js', 'text/javascript; charset=utf-8']],
  ['/yard/Godot-LICENSE.txt', ['runtime/Godot-LICENSE.txt', 'text/plain; charset=utf-8']],
  ['/yard/Godot-COPYRIGHT.txt', ['runtime/Godot-COPYRIGHT.txt', 'text/plain; charset=utf-8']],
]);
const policy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; " +
  "img-src 'self' blob: data:; worker-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export async function serveSwitchyard(request, response) {
  if (request.url === '/yard') {
    response.writeHead(308, { Location: '/yard/' }).end();
    return true;
  }
  const entry = assets.get(request.url);
  if (!entry) return false;

  const [file, type] = entry;
  const asset = new URL('../web/yard/' + file, import.meta.url);
  try {
    const { size } = await stat(asset);
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    const compressed = file.endsWith('.gz');
    const acceptsGzip = (request.headers['accept-encoding'] || '').toLowerCase().split(',').some(item => {
      const [encoding, ...parameters] = item.split(';').map(value => value.trim());
      const quality = parameters.find(value => value.startsWith('q='));
      return encoding === 'gzip' && (!quality || Number(quality.slice(2)) > 0);
    });
    if (type.startsWith('text/html')) headers['Content-Security-Policy'] = policy;
    if (compressed) headers.Vary = 'Accept-Encoding';
    if (compressed && acceptsGzip) headers['Content-Encoding'] = 'gzip';
    if (!compressed || acceptsGzip) headers['Content-Length'] = size;
    response.writeHead(200, headers);
    if (request.method === 'HEAD') response.end();
    else if (compressed && !acceptsGzip) await pipeline(createReadStream(asset), createGunzip(), response);
    else await pipeline(createReadStream(asset), response);
  } catch (error) {
    if (!response.headersSent) response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    else response.destroy();
  }
  return true;
}
