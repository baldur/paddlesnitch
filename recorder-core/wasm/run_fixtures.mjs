// Replays every fixture through the WebAssembly build of the core and
// compares each stream, byte for byte, with the golden files: the same check
// as test/run_fixtures.c, on the build the server will run.
//
//   node wasm/run_fixtures.mjs build/recorder_core.wasm fixtures/*/
//
// The calls.csv parsing mirrors test/run_fixtures.c (format in
// fixtures/README.md). Floats reach the module as f32 parameters, which
// round the parsed double to nearest, as strtof does.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HAS = { tracker: 0x3f, sats: 1, hdop: 2, batt_mv: 4, tx_seq: 8, imu_temp: 16, raw_motion: 32 };
const FILES = ['track.csv', 'motion.csv', 'motion_raw.csv', 'stroke.csv'];
const RC_HAS_RAW_MOTION = 32;

const [wasmPath, ...dirs] = process.argv.slice(2);
if (!wasmPath || dirs.length === 0) {
  console.error('usage: node run_fixtures.mjs CORE.wasm DIR...');
  process.exit(2);
}
const module = new WebAssembly.Module(readFileSync(wasmPath));

// libc's stdio comes along with snprintf, but the core never writes a file:
// these stay uncalled, so the module needs no WASI host.
const neverCalled = (name) => () => { throw new Error(`the core called ${name}`); };

// Streaming = batch through the module: the track and motion files this
// fixture wrote, replayed as the server will, give the same stroke lines.
function replay(track, motion) {
  const out = [[], [], [], []];
  const core = instantiate(out);
  const put = (buf) => {
    const p = core.rcw_alloc(buf.length);
    new Uint8Array(core.memory.buffer, p, buf.length).set(buf);
    return p;
  };
  const t = put(track), m = put(motion);
  core.rcw_replay(t, track.length, m, motion.length);
  core.rcw_free(t);
  core.rcw_free(m);
  if (out[0].length || out[1].length || out[2].length) throw new Error('replay wrote outside RC_STROKE');
  return Buffer.concat(out[3]);
}

function instantiate(out) {
  let memory;
  const instance = new WebAssembly.Instance(module, {
    env: {
      rcw_write(stream, ptr, len) {
        out[stream].push(Buffer.from(new Uint8Array(memory.buffer, ptr, len)));
      },
    },
    wasi_snapshot_preview1: {
      fd_close: neverCalled('fd_close'),
      fd_seek: neverCalled('fd_seek'),
      fd_write: neverCalled('fd_write'),
    },
  });
  memory = instance.exports.memory;
  instance.exports._initialize();
  return { ...instance.exports, memory };
}

// strtoul/atoi/strtod/strtof read a leading number and give 0 for none.
// Not `|| 0`: that turns -0 into 0, and the core writes -0.00.
const int = (s) => parseInt(s, 10) || 0;
const num = (s) => { const v = parseFloat(s); return Number.isNaN(v) ? 0 : v; };
const triple = (s, sep) => {
  const m = new RegExp(`^\\s*(-?\\d+)${sep}(-?\\d+)${sep}(-?\\d+)`).exec(s);
  return m ? [1, int(m[1]), int(m[2]), int(m[3])] : [0, 0, 0, 0];
};

function parseHas(list) {
  let has = 0;
  for (const tok of list.split(' ').filter(Boolean)) {
    if (!(tok in HAS)) throw new Error(`unknown config flag '${tok}'`);
    has |= HAS[tok];
  }
  return has;
}

function firstDiff(name, got, want) {
  let i = 0, line = 1, start = 0;
  while (i < got.length && i < want.length && got[i] === want[i]) {
    if (got[i] === 0x0a) { line++; start = i + 1; }
    i++;
  }
  const lineOf = (b) => { const e = b.indexOf(0x0a, start); return b.subarray(start, e < 0 ? b.length : e).toString(); };
  return `  ${name} line ${line} differs\n    want: ${lineOf(want)}\n    got:  ${lineOf(got)}`;
}

function run(dir) {
  const out = [[], [], [], []];
  let core = null, has = 0, lineno = 0;
  for (const raw of readFileSync(join(dir, 'calls.csv'), 'latin1').split('\n')) {
    lineno++;
    const line = raw.replace(/\r$/, '');
    if (!line || line[0] === '#') continue;
    const f = line.split(',');
    if (f[0] === 'config') {
      has = f.length > 1 ? parseHas(f[1]) : 0;
      core = instantiate(out);
      core.rcw_init(has);
    } else if (!core) {
      throw new Error(`${dir}/calls.csv:${lineno}: the first call must be config`);
    } else if (f[0] === 'finish' && f.length === 1) {
      core.rcw_finish();
    } else if (f[0].startsWith('expect_')) {
      // known answers: checked by the host runner (test/run_fixtures.c)
    } else if (f[0] === 'imu' && f.length === 8) {
      core.rcw_imu(int(f[1]) >>> 0, ...f.slice(2, 8).map(num));
    } else if (f[0] === 'second' && f.length === 16) {
      const opt = (s) => (s !== '' ? [1, num(s)] : [0, 0]);
      core.rcw_second(
        int(f[1]) >>> 0, int(f[2]),
        ...triple(f[3], '-'), ...triple(f[4], ':'),
        num(f[5]), num(f[6]),
        ...opt(f[7]), ...opt(f[8]), ...opt(f[9]),
        f[10] !== '' ? 1 : 0, int(f[10]) >>> 0,
        ...opt(f[11]),
        int(f[12]) >>> 0, int(f[13]) >>> 0, int(f[14]), num(f[15]),
      );
    } else {
      throw new Error(`${dir}/calls.csv:${lineno}: can't read '${f[0]}' (${f.length} fields)`);
    }
  }

  const problems = [];
  FILES.forEach((name, s) => {
    const path = join(dir, name);
    const expected = s !== 2 || (has & RC_HAS_RAW_MOTION) !== 0;
    if (!expected) {
      if (existsSync(path)) problems.push(`  ${name}: not expected without raw_motion`);
      if (out[s].length) problems.push(`  ${name}: written without raw_motion`);
      return;
    }
    if (!existsSync(path)) { problems.push(`  ${path}: missing`); return; }
    const got = Buffer.concat(out[s]);
    const want = readFileSync(path);
    if (!got.equals(want)) problems.push(firstDiff(name, got, want));
  });
  const stroke = replay(Buffer.concat(out[0]), Buffer.concat(out[1]));
  if (!stroke.equals(Buffer.concat(out[3]))) problems.push('  replaying the files gives different stroke lines (streaming != batch)');
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${dir}`);
  for (const p of problems) console.error(p);
  return problems.length === 0;
}

const results = dirs.map(run);
process.exit(results.every(Boolean) ? 0 : 1);
