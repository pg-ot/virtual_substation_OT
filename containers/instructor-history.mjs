import { appendFile, open, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const limit = 1024 * 1024;

async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

async function tail(path) {
  let file;
  try {
    file = await open(path, 'r');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
  try {
    const size = (await file.stat()).size;
    const offset = Math.max(0, size - limit);
    const start = Math.max(0, offset - 1);
    const buffer = Buffer.alloc(size - start);
    let read = 0;
    while (read < buffer.length) {
      const result = await file.read(buffer, read, buffer.length - read, start + read);
      if (!result.bytesRead) break;
      read += result.bytesRead;
    }
    let data = buffer.subarray(0, read);
    if (offset > 0 && data.length) {
      const previous = data[0];
      data = data.subarray(1);
      if (previous !== 10) {
        const newline = data.indexOf(10);
        data = newline < 0 ? data.subarray(data.length) : data.subarray(newline + 1);
      }
    }
    return data.toString('utf8');
  } finally {
    await file.close();
  }
}

export async function recentHistory(path, project) {
  const [backup, current] = await Promise.all([tail(path + '.1'), tail(path)]);
  return (backup + current).split('\n').filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(record => record.project === project)
    .slice(-30);
}

export async function appendHistory(path, record) {
  const line = JSON.stringify(record) + '\n';
  const bytes = Buffer.byteLength(line);
  if (bytes > limit) throw new Error('Instructor history record exceeds the 1 MiB limit');
  const lockPath = path + '.lock';
  let lock;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      lock = await open(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await delay(50);
    }
  }
  if (!lock) throw new Error('Instructor history is locked; check for a running writer or stale lock');
  try {
    const size = await fileSize(path);
    if (size + bytes > limit) {
      const backupTemp = path + '.1.tmp';
      const currentTemp = path + '.tmp';
      await writeFile(backupTemp, await tail(path), { mode: 0o600 });
      await rename(backupTemp, path + '.1');
      await writeFile(currentTemp, line, { mode: 0o600 });
      await rename(currentTemp, path);
    } else {
      if (await fileSize(path + '.1') > limit) {
        const backupTemp = path + '.1.tmp';
        await writeFile(backupTemp, await tail(path + '.1'), { mode: 0o600 });
        await rename(backupTemp, path + '.1');
      }
      await appendFile(path, line, { mode: 0o600 });
    }
  } finally {
    try {
      await lock.close();
    } finally {
      await unlink(lockPath);
    }
  }
}
