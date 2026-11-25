import { readFile } from 'node:fs/promises';
import { parseConfig } from './config.mjs';

const config = parseConfig(await readFile('/training-config/active.json'));
process.env.LAB_IEC104_HOST = config.iec104Host;
process.env.LAB_IEC104_PORT = String(config.iec104Port);
console.log(`Recovery exercise: IEC 104 target ${config.iec104Host}:${config.iec104Port}`);
process.argv[2] = 'control-centre';
await import('/app/src/component-service.mjs');
