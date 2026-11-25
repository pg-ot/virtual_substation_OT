import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const [capture, expectedArgument, cycleArgument = '80', ...extra] = process.argv.slice(2);
const expected = Number(expectedArgument);
const samplesPerCycle = Number(cycleArgument);
const samplesPerSecond = samplesPerCycle * 50;
if (!capture || ![1, 4].includes(expected) || ![8, 80].includes(samplesPerCycle) || extra.length) {
  throw new Error('Usage: node containers/sv-capture-analysis.mjs <capture.pcap> <ASDUs-per-frame: 1|4> [samples-per-cycle: 8|80]');
}

const exec = promisify(execFile);
const { stdout } = await exec('docker', [
  'run', '--rm', '-v', resolve(capture) + ':/capture/input.pcap:ro',
  '--entrypoint', 'tshark', 'ss01-kali:dev', '-r', '/capture/input.pcap', '-Y', 'sv',
  '-T', 'fields', '-E', 'separator=|', '-e', 'frame.time_epoch', '-e', 'sv.noASDU',
  '-e', 'sv.svID', '-e', 'sv.smpCnt', '-e', 'sv.confRev', '-e', 'sv.smpSynch',
  '-e', 'sv.smpRate', '-e', 'sv.seqData',
], { timeout: 60000, maxBuffer: 32 * 1024 * 1024 });

const lines = stdout.split(/\r?\n/).filter(Boolean);
if (!lines.length) throw new Error('No Sampled Values frames decoded.');
const values = { identifiers: new Set(), revisions: new Set(), synchronization: new Set(), rates: new Set(), quality: new Set() };
const currents = [];
const voltages = [];
let lastCount = null;
let lastTime = null;
let gaps = 0;
let missing = 0;
let backwards = 0;
let maximumMissing = 0;
let minInterval = Infinity;
let maxInterval = 0;
let window = [];

for (const [index, line] of lines.entries()) {
  const fields = line.split('|');
  if (fields.length !== 8 || Number(fields[1]) !== expected) throw new Error(`Unexpected frame structure at ${index + 1}`);
  const time = Number(fields[0]);
  if (!Number.isFinite(time)) throw new Error(`Invalid capture timestamp at ${index + 1}`);
  if (lastTime !== null) {
    const interval = (time - lastTime) * 1000;
    minInterval = Math.min(minInterval, interval);
    maxInterval = Math.max(maxInterval, interval);
  }
  lastTime = time;
  const columns = fields.slice(2).map(field => field.split(','));
  if (columns.some(column => column.length !== expected)) throw new Error(`Incomplete ASDU fields at frame ${index + 1}`);
  for (let i = 0; i < expected; i++) {
    const [identifier, countText, revision, synchronization, rate, hex] = columns.map(column => column[i]);
    const count = Number(countText);
    if (!/^\d+$/.test(countText) || count >= samplesPerSecond ||
        Number(rate) !== samplesPerCycle || !/^[\da-f]{128}$/i.test(hex)) {
      throw new Error(`Invalid sample counter or dataset at frame ${index + 1}`);
    }
    values.identifiers.add(identifier);
    values.revisions.add(revision);
    values.synchronization.add(synchronization);
    values.rates.add(rate);
    if (lastCount !== null) {
      const delta = (count - lastCount + samplesPerSecond) % samplesPerSecond;
      if (delta !== 1) {
        window = [];
        if (delta === 0 || delta >= samplesPerSecond / 2) backwards++;
        else {
          gaps++;
          missing += delta - 1;
          maximumMissing = Math.max(maximumMissing, delta - 1);
        }
      }
    }
    lastCount = count;
    const data = Buffer.from(hex, 'hex');
    let allGood = true;
    for (let channel = 0; channel < 8; channel++) {
      const quality = data.readUInt32BE(channel * 8 + 4);
      values.quality.add(quality);
      if (quality !== 0) allGood = false;
    }
    if (!allGood) {
      window = [];
      continue;
    }
    window.push({ current: data.readInt32BE(0) / 1000, voltage: data.readInt32BE(32) / 100 });
    if (window.length === samplesPerCycle) {
      const rms = key => Math.sqrt(window.reduce((sum, sample) => sum + sample[key] ** 2, 0) / samplesPerCycle);
      currents.push(rms('current'));
      voltages.push(rms('voltage') * Math.sqrt(3) / 1000);
      window = [];
    }
  }
}
const bounds = items => items.length ? { min: Math.min(...items), max: Math.max(...items) } : null;
console.log(JSON.stringify({
  capture: resolve(capture), frames: lines.length, samples: lines.length * expected,
  asdusPerFrame: expected, identifiers: [...values.identifiers], revisions: [...values.revisions],
  synchronization: [...values.synchronization], samplesPerCycle: [...values.rates], qualityWords: [...values.quality],
  gaps, missingSamples: missing, maximumMissingSamples: maximumMissing, duplicateOrBackwardCounts: backwards,
  frameIntervalMs: lines.length > 1 ? { min: minInterval, max: maxInterval } : null,
  contiguousWindows: currents.length, phaseCurrentRmsAmperes: bounds(currents), lineVoltageRmsKv: bounds(voltages),
  scope: 'Wireshark decoding and capture continuity of the engineered experimental dataset, not a conformance test.',
}, null, 2));
