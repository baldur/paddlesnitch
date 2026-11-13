// The courses carry leaderboards, so a change to how they look (a building's
// style, woods, trees, features, labels) must never move what a race runs on:
// the river line, its widths, the route, start and finish, gates, cues, buoys,
// banks, walls, moored boats, posts, the mapped water, portages, birds. Each
// course's racing data is fingerprinted here; regenerating a course for its
// looks must leave these as they are. Change a fingerprint only on purpose,
// knowing the leaderboard's times stop being comparable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const LOOKS = ['buildings', 'woods', 'trees', 'features', 'places', 'name', 'title', 'blurb', 'credit', 'licence'];
// Each racing key's fingerprint (objects' keys sorted, so only a changed value counts).
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const hash = (v) => createHash('sha256').update(JSON.stringify(sorted(v))).digest('hex').slice(0, 12);
const racing = (data) => Object.fromEntries(Object.keys(data).filter((k) => !LOOKS.includes(k)).sort().map((k) => [k, hash(data[k])]));
const lock = JSON.parse(await readFile(new URL('./course-lock.json', import.meta.url), 'utf8'));

for (const [id, keys] of Object.entries(lock)) {
  test(`${id}: what the race runs on is unchanged (only its looks may change)`, async () => {
    const data = JSON.parse(await readFile(new URL(`../reading-thames/courses/${id}.json`, import.meta.url), 'utf8'));
    assert.ok(data.line && data.start !== undefined && data.finish !== undefined, 'has a line, a start and a finish');
    // Key by key, so a failure says what moved (a gate, a bank, the line).
    assert.deepEqual(racing(data), keys);
  });
}
