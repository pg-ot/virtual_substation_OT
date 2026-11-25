import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const project = process.env.COMPOSE_PROJECT_NAME;
assert.ok(project && /overview/i.test(project) && project !== 'ss01-bench',
  'Run only in a uniquely named isolated overview test project.');
const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const compose = async (...args) => (await exec('docker', ['compose', ...args], {
  cwd: root, env: process.env, timeout: 15000,
})).stdout.trim();
const port = await compose('port', 'station-hmi', '8080');
assert.match(port, /^127\.0\.0\.1:\d+$/);
const base = `http://${port}`;

const page = await fetch(`${base}/lab-overview`);
assert.equal(page.status, 200);
assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
const html = await page.text();
for (const label of ['Station SCADA', 'PRF01', 'BRF01', 'SIMF01', 'IEC 104', 'DNP3', 'Kali workstation', 'Protection path']) {
  assert.ok(html.includes(label), `Missing ${label}`);
}
assert.match(await (await fetch(base)).text(), /href="\/lab-overview"/);
const config = await (await fetch(`${base}/lab-overview/config`)).json();
assert.equal(config.inputMode, process.env.EXPECT_INPUT_MODE || 'mms');
for (const [asset, [variable, fallback]] of Object.entries({
  plant: ['LAB_PLANT_WEB_PORT', 8081],
  protection: ['LAB_PROTECTION_WEB_PORT', 8082],
  breaker: ['LAB_BREAKER_WEB_PORT', 8083],
  gateway: ['LAB_GATEWAY_WEB_PORT', 8084],
  centre: ['LAB_CONTROL_CENTRE_WEB_PORT', 8085],
  dnp3Gateway: ['LAB_DNP3_GATEWAY_WEB_PORT', 8086],
  dnp3Centre: ['LAB_DNP3_CONTROL_CENTRE_WEB_PORT', 8087],
  merging: ['LAB_MERGING_WEB_PORT', 8088],
  kali: ['LAB_KALI_WEB_PORT', 6088],
})) assert.equal(config.ports[asset], Number(process.env[variable] || fallback), `${asset} port`);
const reachability = await (await fetch(`${base}/lab-overview/reachability`)).json();
for (const asset of ['plant', 'protection', 'breaker', 'gateway', 'centre']) {
  assert.equal(reachability.pages[asset], true, `${asset} page should be reachable`);
}
assert.equal(reachability.pages.kali, false, 'unstarted optional Kali must not be reported reachable');
assert.equal(reachability.pages.merging, config.inputMode === 'sv', 'merging-unit endpoint status');
if ((process.env.COMPOSE_PROFILES || '').split(',').includes('dnp3')) {
  assert.equal(reachability.pages.dnp3Gateway, true, 'DNP3 gateway endpoint');
  assert.equal(reachability.pages.dnp3Centre, true, 'DNP3 centre endpoint');
}
assert.ok(Number.isFinite(reachability.checkedAt));
console.log(`Lab overview passed: HTML, HMI navigation, configured ports, ${config.inputMode} input mode, and page reachability.`);
