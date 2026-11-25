import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const [capture, minimumArgument, maximumArgument, ...extra] = process.argv.slice(2);
if (!capture || extra.length || ((minimumArgument === undefined) !== (maximumArgument === undefined))) {
  throw new Error('Usage: node containers/goose-capture-analysis.mjs <capture.pcap> [min-ms max-ms]');
}
const limits = minimumArgument === undefined ? null : {
  min: Number(minimumArgument), max: Number(maximumArgument),
};
if (limits && (!Number.isFinite(limits.min) || !Number.isFinite(limits.max) ||
    limits.min <= 0 || limits.max < limits.min)) throw new Error('Invalid nominal timing values.');

const exec = promisify(execFile);
const { stdout } = await exec('docker', ['run', '--rm', '-v', resolve(capture) + ':/capture/input.pcap:ro',
  '--entrypoint', 'tshark', 'ss01-kali:dev', '-r', '/capture/input.pcap', '-Y', 'goose',
  '-T', 'fields', '-E', 'separator=,', '-e', 'frame.time_epoch', '-e', 'goose.stNum',
  '-e', 'goose.sqNum', '-e', 'goose.timeAllowedtoLive', '-e', 'goose.gocbRef', '-e', 'goose.appid', '-e', 'eth.src'],
  { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });

const frames = stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
  const raw = line.split(',');
  const fields = raw.slice(0, 4).map(Number);
  if (raw.length !== 7 || raw.slice(0, 6).some(value => value.trim() === '') ||
      fields.some(value => !Number.isFinite(value))) {
    throw new Error('Cannot decode GOOSE timing fields: ' + line);
  }
  const [time, state, sequence, ttl] = fields;
  return { time, state, sequence, ttl, controlBlock: raw[4], appId: raw[5], source: raw[6] || null };
});
if (frames.length < 2) throw new Error('At least two decoded GOOSE frames are required.');
if (frames.some(frame => frame.controlBlock !== frames[0].controlBlock || frame.appId !== frames[0].appId ||
    frame.source !== frames[0].source)) {
  throw new Error('Capture contains multiple GOOSE sources or streams; filter it before analysis.');
}

const intervals = [];
const anomalies = [];
for (let index = 1; index < frames.length; index++) {
  const previous = frames[index - 1];
  const frame = frames[index];
  const milliseconds = (frame.time - previous.time) * 1000;
  const stateChanged = frame.state !== previous.state;
  intervals.push({ milliseconds, stateChanged });
  if (milliseconds < 0) anomalies.push(`frame ${index + 1}: capture timestamp went backwards`);
  if (milliseconds >= previous.ttl) anomalies.push(`frame ${index + 1}: interval reached previous TTL`);
  if (!stateChanged && frame.sequence !== ((previous.sequence + 1) >>> 0)) {
    anomalies.push(`frame ${index + 1}: same-state sequence did not advance by one`);
  }
  if (stateChanged && milliseconds < previous.ttl &&
      ((frame.state - previous.state) >>> 0) >= 0x80000000) {
    anomalies.push(`frame ${index + 1}: state moved backwards while the previous state was live`);
  }
  if (stateChanged && frame.sequence !== 0) anomalies.push(`frame ${index + 1}: first observed sequence is not zero`);
}

const stable = intervals.filter(interval => !interval.stateChanged).map(interval => interval.milliseconds);
const round = value => Math.round(value * 1000) / 1000;
const bounds = stable.reduce((result, value) => ({ min: Math.min(result.min, value),
  max: Math.max(result.max, value) }), { min: Infinity, max: -Infinity });
console.log(JSON.stringify({
  capture: resolve(capture), frames: frames.length,
  controlBlock: frames[0].controlBlock, appId: frames[0].appId, source: frames[0].source,
  firstState: frames[0].state, lastState: frames.at(-1).state,
  stateChanges: intervals.length - stable.length,
  sameStateIntervalMs: stable.length ? { min: round(bounds.min), max: round(bounds.max) } : null,
  nominalComparison: limits ? {
    minMs: limits.min, maxMs: limits.max,
    belowMin: stable.filter(value => value < limits.min).length,
    aboveMax: stable.filter(value => value > limits.max).length,
  } : null,
  ttlValuesMs: [...new Set(frames.map(frame => frame.ttl))],
  anomalies,
  scope: 'Observed capture continuity and timing only. Compare with the engineered profile and independent test criteria.',
}, null, 2));
