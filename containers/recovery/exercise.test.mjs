import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('./exercise.mjs', import.meta.url));
const command = (...args) => exec(process.execPath, [script, ...args]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('restore requires the independently supplied hash and preserves active config on rejection', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ss01-recovery-test-'));
  const directory = join(parent, 'exercise');
  try {
    const prepared = await command('prepare', directory);
    const backup = join(directory, 'approved-backup.json');
    const original = await readFile(backup);
    const trusted = hash(original);
    assert.match(prepared.stdout, new RegExp(trusted));
    await assert.rejects(command('prepare', directory));
    await command('inject', directory);
    const injected = await readFile(join(directory, 'active.json'));
    assert.equal(JSON.parse(injected).iec104Port, 2405);
    await assert.rejects(command('inject', directory), error => /Expected the healthy/.test(error.stderr));

    await command('verify', backup, trusted);
    await assert.rejects(command('restore', directory, backup, '0'.repeat(64)),
      error => /SHA-256 mismatch/.test(error.stderr));
    assert.deepEqual(await readFile(join(directory, 'active.json')), injected);
    const altered = join(parent, 'altered.json');
    await writeFile(altered, Buffer.concat([original, Buffer.from(' ')]));
    await assert.rejects(command('verify', altered, trusted), error => /SHA-256 mismatch/.test(error.stderr));
    await assert.rejects(command('restore', directory, altered, trusted));
    assert.deepEqual(await readFile(join(directory, 'active.json')), injected);

    const wrongConfig = Buffer.from('{"version":1,"iec104Host":"iec104-supervisory","iec104Port":2405}\n');
    await writeFile(altered, wrongConfig);
    await assert.rejects(command('restore', directory, altered, hash(wrongConfig)),
      error => /expected training gateway port/.test(error.stderr));
    assert.deepEqual(await readFile(join(directory, 'active.json')), injected);
    await command('restore', directory, backup, trusted);
    assert.deepEqual(await readFile(join(directory, 'active.json')), original);
    await assert.rejects(command('inject', parent), error => /ENOENT|Not a prepared/.test(error.stderr));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
