// Compare WebKit frame times between two runs of browsers.mjs on the same
// machine (games-speed.yml): main's games, then the pull request's.
//
//   node games/tests/frame-compare.mjs <main log> <pr log>
//
// Prints each case, the median and worst ratio, and exits 1 when the median
// is over LIMIT. Pure parts are exported for frame-compare.test.js.
import { readFileSync } from 'node:fs';

export const LIMIT = 1.15;

/** { case name: [ms, ...] } from a browsers.mjs log ("✔ name: ..., 412 ms frames"). */
export function frameTimes(log) {
  const out = {};
  for (const line of log.split('\n')) {
    const m = line.match(/[✔✖] (.+?): .*?(\d+) ms frames/);
    if (m) (out[m[1]] ??= []).push(Number(m[2]));
  }
  return out;
}

/** Ratios pr/main for every case both logs have, in order, with the median and worst. */
export function compare(main, pr) {
  const rows = [];
  for (const [name, prMs] of Object.entries(pr)) {
    const mainMs = main[name];
    if (!mainMs) continue;
    prMs.forEach((ms, i) => {
      if (mainMs[i]) rows.push({ name, main: mainMs[i], pr: ms, ratio: ms / mainMs[i] });
    });
  }
  const sorted = rows.map((r) => r.ratio).sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length === 0 ? NaN : sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { rows, median, worst: sorted.length ? sorted[sorted.length - 1] : NaN };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mainLog, prLog] = process.argv.slice(2);
  const { rows, median, worst } = compare(frameTimes(readFileSync(mainLog, 'utf8')), frameTimes(readFileSync(prLog, 'utf8')));
  for (const r of rows) console.log(`${r.name}: main ${r.main} ms, pr ${r.pr} ms (${r.ratio.toFixed(2)}x)`);
  if (!rows.length) {
    console.log('no case ran in both: nothing to compare');
    process.exit(1);
  }
  console.log(`median ${median.toFixed(2)}x, worst ${worst.toFixed(2)}x over ${rows.length} cases (limit ${LIMIT}x on the median)`);
  process.exit(median > LIMIT ? 1 : 0);
}
