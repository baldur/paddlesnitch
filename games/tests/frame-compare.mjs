// Compare WebKit frame times between two runs of browsers.mjs on the same
// machine (games-speed.yml): main's games, then the pull request's.
//
//   node games/tests/frame-compare.mjs <main log> <pr log>
//
// Prints each case, the median and worst ratio, and exits 1 when the median
// is over LIMIT. Pure parts are exported for frame-compare.test.js.
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const LIMIT = 1.15;

/**
 * { case name: [ms, ...] } from a browsers.mjs log ("✔ name: ..., 412 ms frames").
 * A case whose renderer never drew reports 0 ms; that's kept as null, so it
 * still holds its place among repeated names but is never compared.
 */
export function frameTimes(log) {
  const out = {};
  for (const line of log.split('\n')) {
    const m = line.match(/[✔✖] (.+?): .*?(\d+) ms frames/);
    if (m) (out[m[1]] ??= []).push(Number(m[2]) || null);
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
      if (mainMs[i] && ms) rows.push({ name, main: mainMs[i], pr: ms, ratio: ms / mainMs[i] });
    });
  }
  const sorted = rows.map((r) => r.ratio).sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length === 0 ? NaN : sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { rows, median, worst: sorted.length ? sorted[sorted.length - 1] : NaN };
}

/** Whether the check passes: something was compared and the median is within LIMIT. */
export function passes({ rows, median }) {
  return rows.length > 0 && median <= LIMIT;
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [mainLog, prLog] = process.argv.slice(2);
  const result = compare(frameTimes(readFileSync(mainLog, 'utf8')), frameTimes(readFileSync(prLog, 'utf8')));
  for (const r of result.rows) console.log(`${r.name}: main ${r.main} ms, pr ${r.pr} ms (${r.ratio.toFixed(2)}x)`);
  if (!result.rows.length) console.log('no case drew frames in both runs: nothing to compare');
  else console.log(`median ${result.median.toFixed(2)}x, worst ${result.worst.toFixed(2)}x over ${result.rows.length} cases (limit ${LIMIT}x on the median)`);
  process.exit(passes(result) ? 0 : 1);
}
