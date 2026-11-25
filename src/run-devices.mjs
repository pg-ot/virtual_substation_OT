import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('./device-service.mjs', import.meta.url));
const children = ['feeder', 'ied', 'gateway', 'supervisory'].map(role =>
  spawn(process.execPath, [entry, role], { stdio: 'inherit' }));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) {
  child.on('error', () => { process.exitCode = 1; stop(); });
  child.on('exit', () => { if (!stopping) { process.exitCode = 1; stop(); } });
}
