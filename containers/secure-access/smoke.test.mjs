import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const exec = promisify(execFile);
const project = `ss01-access-test-${randomBytes(6).toString('hex')}`;
const mock = `${project}-gateway-fixture`;
const client = `${project}-access-client-1`;
const jump = `${project}-access-jump-1`;
const composeArgs = ['compose', '-p', project, '-f', 'compose.yaml',
  '-f', 'compose.secure-access.yaml', '--profile', 'secure-access'];
const sshOptions = ['-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
  '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=yes',
  '-o', 'UserKnownHostsFile=/keys/known_hosts'];

async function docker(...args) {
  return exec('docker', args, { timeout: 60000, maxBuffer: 1024 * 1024 });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function getPage(port) {
  return new Promise((resolve, reject) => {
    const request = get(`http://127.0.0.1:${port}/`, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve(body));
      response.on('error', reject);
    });
    const timer = setTimeout(() => request.destroy(new Error('HTTP request timed out')), 5000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}

test('VPN and jump host enforce the training path', { timeout: 180000 }, async () => {
  const port = await availablePort();
  const env = { ...process.env, LAB_SECURE_ACCESS_PORT: String(port) };
  const compose = (...args) => exec('docker', [...composeArgs, ...args], { env, timeout: 90000 });
  let started = false;
  try {
    const existing = await docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`);
    assert.equal(existing.stdout.trim(), '', 'test project must be unused');
    started = true;
    await compose('up', '-d', 'access-client');
    await docker('run', '-d', '--name', mock, '--network', `${project}_management`,
      '--network-alias', 'web-gateway', '--entrypoint', 'node', 'ss01-bench:dev',
      '-e', 'require("http").createServer((q,s)=>s.end("gateway-test")).listen(8090,"0.0.0.0")');

    await assert.rejects(getPage(port), 'no SSH forward should exist before approval');
    await docker('exec', client, 'accessctl', 'connect');
    assert.equal(await getPage(port), 'gateway-test');
    const status = await docker('exec', client, 'accessctl', 'status');
    assert.match(status.stdout, /latest handshake:/);
    assert.match(status.stdout, /SSH forward: active/);

    await docker('exec', client, 'ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', '/tmp/other-key');
    await assert.rejects(docker('exec', client, 'ssh', ...sshOptions,
      '-i', '/tmp/other-key', 'vendor@10.77.0.1', 'true'),
    error => /Permission denied/.test(error.stderr));
    await assert.rejects(docker('exec', client, 'ssh', ...sshOptions,
      '-i', '/keys/id_ed25519', 'vendor@10.77.0.1', 'id'));
    await docker('exec', client, 'ssh', '-S', '/tmp/ss01-ssh', '-O', 'forward',
      '-L', '127.0.0.1:18086:web-protection:8090', 'vendor@10.77.0.1');
    await assert.rejects(docker('exec', client, 'curl', '-fsS', '--max-time', '5',
      'http://127.0.0.1:18086/'));
    const logs = await docker('logs', jump);
    assert.match(logs.stderr, /web-protection port 8090.*denied/);

    await docker('exec', client, 'accessctl', 'disconnect');
    await assert.rejects(getPage(port), 'closing the SSH session must stop the forward');
    const disconnected = await docker('exec', client, 'accessctl', 'status');
    assert.match(disconnected.stdout, /SSH forward: inactive/);

    await compose('stop', 'access-client', 'access-vpn', 'access-jump');
    await compose('up', '-d', 'access-client');
    await docker('exec', client, 'accessctl', 'connect');
    assert.equal(await getPage(port), 'gateway-test', 'credentials must remain usable after restart');
    await docker('exec', client, 'accessctl', 'disconnect');
  } finally {
    if (started) {
      try {
        await docker('rm', '-f', mock);
      } catch (error) {
        if (!/No such container/.test(error.stderr || '')) throw error;
      } finally {
        await compose('down', '--volumes', '--remove-orphans');
      }
    }
  }
});
