import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { appendHistory, recentHistory } from './instructor-history.mjs';

const limit = 1024 * 1024;
async function withHistory(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'ss01-history-'));
  const path = join(directory, 'history.jsonl');
  try {
    await callback(path);
  } finally {
    for (const suffix of ['', '.1', '.lock', '.tmp', '.1.tmp']) {
      try { await unlink(path + suffix); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await rmdir(directory);
  }
}

test('rotates history within the limit and retains the latest records', async () => {
  await withHistory(async path => {
    const record = number => ({ project: 'bench', number, detail: 'x'.repeat(600000) });
    await appendHistory(path, record(1));
    await appendHistory(path, record(2));
    await appendHistory(path, record(3));
    assert.ok((await stat(path)).size <= limit);
    assert.ok((await stat(path + '.1')).size <= limit);
    assert.deepEqual((await recentHistory(path, 'bench')).map(item => item.number), [2, 3]);
  });
});

test('bounds reads and rotation of an existing oversized history', async () => {
  await withHistory(async path => {
    await writeFile(path, JSON.stringify({ project: 'bench', detail: 'x'.repeat(limit) }) + '\n' +
      JSON.stringify({ project: 'bench', number: 2 }) + '\n');
    assert.deepEqual((await recentHistory(path, 'bench')).map(item => item.number), [2]);
    await appendHistory(path, { project: 'bench', number: 3 });
    assert.ok((await stat(path)).size <= limit);
    assert.ok((await stat(path + '.1')).size <= limit);
    assert.deepEqual((await recentHistory(path, 'bench')).map(item => item.number), [2, 3]);
  });
});

test('bounds an existing oversized backup even when the current file fits', async () => {
  await withHistory(async path => {
    await writeFile(path + '.1', JSON.stringify({ project: 'bench', detail: 'x'.repeat(limit) }) + '\n' +
      JSON.stringify({ project: 'bench', number: 1 }) + '\n');
    await appendHistory(path, { project: 'bench', number: 2 });
    assert.ok((await stat(path + '.1')).size <= limit);
    assert.deepEqual((await recentHistory(path, 'bench')).map(item => item.number), [1, 2]);
  });
});

test('serializes concurrent writers and rejects oversized records without losing history', async () => {
  await withHistory(async path => {
    await Promise.all(Array.from({ length: 5 }, (_, number) => appendHistory(path, { project: 'bench', number })));
    assert.deepEqual((await recentHistory(path, 'bench')).map(item => item.number).sort(), [0, 1, 2, 3, 4]);
    const before = await readFile(path, 'utf8');
    await assert.rejects(appendHistory(path, { project: 'bench', detail: 'x'.repeat(limit) }), /exceeds/);
    assert.equal(await readFile(path, 'utf8'), before);
  });
});

test('surfaces malformed history and treats a missing history as empty', async () => {
  await withHistory(async path => {
    assert.deepEqual(await recentHistory(path, 'bench'), []);
    await writeFile(path, 'not json\n');
    await assert.rejects(recentHistory(path, 'bench'), SyntaxError);
  });
});
