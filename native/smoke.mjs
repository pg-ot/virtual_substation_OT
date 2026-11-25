import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const build = process.argv[2];
if (!build) throw new Error('Usage: node native/smoke.mjs <build-directory> [--dnp3]');
const children = [];

function launch(program, ...args) {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const child = spawn(resolve(build, program + suffix), args, { stdio: 'pipe' });
  children.push(child);
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const done = new Promise(resolveExit => {
    child.on('error', error => resolveExit({ error }));
    child.on('close', code => resolveExit({ code }));
  });
  return { child, done, output: () => output };
}

async function until(process, pattern, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pattern.test(process.output())) return;
    if (process.child.exitCode !== null) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  assert.match(process.output(), pattern);
}

async function complete(process, expectedCode = 0) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null || process.child.signalCode !== null) {
      const result = await process.done;
      assert.equal(result.code, expectedCode, process.output());
      return process.output();
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  throw new Error('Native command did not finish: ' + process.output());
}

try {
  const ied = launch('feeder-ied');
  await until(ied, /MMS ready/);
  const protection = await complete(launch('station-client', 'goose-config'));
  assert.match(protection, /dataset=PRF01LD0\/LLN0[.$]ProtectionData confRev=3 appid=4096 min_ms=20 max_ms=1000/);
  const initial = await complete(launch('station-client', 'read'));
  assert.match(initial, /breaker=CLOSED position_quality=0 position_time_ms=[1-9]\d+ trip=0 current_A=120/);
  const reports = launch('station-client', 'watch');
  await until(reports, /MMS report breaker=CLOSED/);

  const gateway = launch('telecontrol104', 'gateway');
  await until(gateway, /IEC 104 ready/);
  const cc = launch('telecontrol104', 'master', 'watch');
  await until(cc, /GI current_A=120/);
  assert.match(cc.output(), /GI breaker=CLOSED quality=0/);

  const useDnp = process.argv.includes('--dnp3');
  let dnpMaster;
  if (useDnp) {
    const outstation = launch('telecontrol-dnp3', 'outstation');
    await until(outstation, /DNP3 ready/);
    dnpMaster = launch('telecontrol-dnp3', 'master');
    await until(dnpMaster, /\[0\] : 120 : 1 : /);
  }

  ied.child.stdin.write('fault\n');
  await until(ied, /Applied fault/);
  const tripped = await complete(launch('station-client', 'read'));
  assert.match(tripped, /breaker=OPEN position_quality=0 position_time_ms=[1-9]\d+ trip=1 current_A=0/);
  await until(reports, /MMS report trip=1/);
  await until(cc, /EVENT breaker=OPEN quality=0/);
  assert.match(cc.output(), /EVENT trip=1/);
  if (dnpMaster) {
    await until(dnpMaster, /\[0\] : DETERMINED_OFF : 65 : [1-9]\d+/);
    await until(dnpMaster, /\[0\] : 0 : 1 : [1-9]\d+/);
  }

  ied.child.stdin.write('clear\n');
  await until(ied, /Applied clear/);
  assert.match(await complete(launch('station-client', 'close'), 1), /command=REJECTED/);
  ied.child.stdin.write('reset\n');
  await until(ied, /Applied reset/);
  assert.match(await complete(launch('station-client', 'close')), /command=ACCEPTED[\s\S]*breaker=CLOSED/);
  console.log('Native MMS reads, reports and control, protection interlock, and IEC 104 interrogation and events passed.');
  if (dnpMaster) console.log('Native DNP3 integrity and double-bit event received.');
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}
