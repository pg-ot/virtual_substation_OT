import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const [exportDirectory, noticesDirectory] = process.argv.slice(2);
if (!exportDirectory || !noticesDirectory) {
  throw new Error('Usage: node yard/package-web.mjs <Godot export directory> <directory with LICENSE.txt and COPYRIGHT.txt>');
}
const output = new URL('../web/yard/runtime/', import.meta.url);
await mkdir(output, { recursive: true });
for (const name of ['yard.js', 'yard.pck']) {
  await copyFile(resolve(exportDirectory, name), new URL(name, output));
}
const worklets = ['yard.audio.worklet.js', 'yard.audio.position.worklet.js'];
const exported = await readdir(exportDirectory);
for (const name of worklets.filter(file => exported.includes(file))) {
  await copyFile(resolve(exportDirectory, name), new URL(name, output));
}
for (const notice of ['LICENSE.txt', 'COPYRIGHT.txt']) {
  await copyFile(resolve(noticesDirectory, notice), new URL('Godot-' + notice, output));
}
await pipeline(createReadStream(resolve(exportDirectory, 'yard.wasm')), createGzip({ level: 9 }),
  createWriteStream(new URL('yard.wasm.gz', output)));
