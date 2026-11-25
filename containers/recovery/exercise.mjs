import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { configBytes, parseConfig } from './config.mjs';

const marker = 'SS01-RECOVERY-EXERCISE-1\n';
const usage = 'Usage: node containers/recovery/exercise.mjs prepare|inject <new-or-existing-directory> | verify <backup-file> <trusted-sha256> | restore <directory> <backup-file> <trusted-sha256>';
const [action, ...args] = process.argv.slice(2);

async function exerciseDirectory(input) {
  const directory = resolve(input);
  if (!(await lstat(directory)).isDirectory() || await readFile(join(directory, '.ss01-recovery'), 'utf8') !== marker) {
    throw new Error('Not a prepared SS-01 recovery exercise directory');
  }
  if (!(await lstat(join(directory, 'active.json'))).isFile()) {
    throw new Error('Active configuration is not a regular file');
  }
  return directory;
}

async function verifiedBackup(file, expected) {
  if (!/^[a-fA-F0-9]{64}$/.test(expected || '')) throw new Error('A trusted 64-character SHA-256 is required');
  const bytes = await readFile(resolve(file));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected.toLowerCase()) throw new Error('SHA-256 mismatch: backup rejected');
  if (parseConfig(bytes).iec104Port !== 2404) throw new Error('Backup does not contain the expected training gateway port');
  return { bytes, actual };
}

async function replaceActive(directory, bytes) {
  const temporary = join(directory, `.active-${randomBytes(12).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, join(directory, 'active.json'));
  } finally {
    await rm(temporary, { force: true });
  }
}

async function run() {
  if (action === 'prepare' && args.length === 1) {
    const directory = resolve(args[0]);
    await mkdir(directory);
    const bytes = configBytes(2404);
    await writeFile(join(directory, '.ss01-recovery'), marker, { flag: 'wx' });
    await writeFile(join(directory, 'active.json'), bytes, { flag: 'wx' });
    await writeFile(join(directory, 'approved-backup.json'), bytes, { flag: 'wx' });
    const hash = createHash('sha256').update(bytes).digest('hex');
    console.log(`Prepared ${directory}\nBackup: ${join(directory, 'approved-backup.json')}\nSHA-256: ${hash}\nDeliver the fingerprint to trainees through a separate trusted channel.`);
  } else if (action === 'inject' && args.length === 1) {
    const directory = await exerciseDirectory(args[0]);
    const current = parseConfig(await readFile(join(directory, 'active.json')));
    if (current.iec104Port !== 2404) throw new Error('Expected the healthy training configuration before injection');
    await replaceActive(directory, configBytes(2405));
    console.log('Injected port 2405 into active.json. Restart the isolated control-centre to apply it.');
  } else if (action === 'verify' && args.length === 2) {
    const result = await verifiedBackup(args[0], args[1]);
    console.log(`Verified ${basename(args[0])}: SHA-256 ${result.actual}`);
  } else if (action === 'restore' && args.length === 3) {
    const directory = await exerciseDirectory(args[0]);
    const result = await verifiedBackup(args[1], args[2]);
    await replaceActive(directory, result.bytes);
    console.log(`Restored verified SHA-256 ${result.actual}. Restart the isolated control-centre to apply it.`);
  } else {
    throw new Error(usage);
  }
}

try {
  await run();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
