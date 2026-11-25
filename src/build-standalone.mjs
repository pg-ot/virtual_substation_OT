import { readFile, writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const sources = [
  'src/feeder.mjs', 'src/gateway.mjs', 'src/ied.mjs', 'src/classroom.mjs',
  'web/yard.mjs', 'web/single-line.mjs', 'web/station.mjs',
];
const modules = await Promise.all(sources.map(read));
const code = modules.map(source => source.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')).join('\n');
new Script(code);
const [template, css] = await Promise.all([read('web/index.html'), read('web/station.css')]);
const html = template
  .replace('<link rel="stylesheet" href="/station.css">', () => '<style>\n' + css + '\n</style>')
  .replace('<script type="module" src="/station.mjs"></script>', '')
  .replace('</body>', () => '<script>\n' + code + '\n</script>\n</body>');
await writeFile(new URL('../station-hmi.html', import.meta.url), html);
