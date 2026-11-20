// Teaching as you go: each part of paddling is explained the first time it
// matters, once per device, instead of all at once before you start.
// Pure: main.js feeds it the moment and shows what it returns.

export const TAUGHT_KEY = 'snitchmedia:kayak:taught';

// The lessons, in the order they're checked. `when` sees the moment:
// { angle (balance needle, degrees), rhythm (0..1), draft (0..1), racing,
//   time (race seconds), rate (strokes a minute), stamina (0..1), sprinting,
//   assist (balance assist on, or tilt not working yet on a phone), scull, outing }.
export const LESSONS = [
  {
    key: 'lean',
    when: (m) => !m.assist && !m.scull && Math.abs(m.angle) > 25,
    text: (how) => `The boat's tipping. Keep the needle in the middle: ${how.lean}`,
    now: true, // before you go in: it doesn't wait behind the starter's words
  },
  {
    key: 'wash',
    when: (m) => !m.scull && m.racing && m.draft > 0.3, // not the boats drifting up beside you on the start line
    text: () => "You're on a wash: you go further for less effort, and your sprint bar fills",
  },
  {
    key: 'rhythm',
    when: (m) => !m.scull && m.rhythm > 0.9,
    text: () => 'An even beat fills the rhythm bar: keep it up for a few percent more speed',
  },
  {
    key: 'sprint',
    when: (m) => !m.scull && m.racing && m.time > 20 && m.rate >= 50 && !m.sprinting && m.stamina > 0.8,
    text: () => 'Paddle quicker than 90 a minute to sprint: faster, but it spends the sprint bar',
  },
];

// The next lesson for this moment, or null: none on an outing, none already taught.
export function nextLesson(moment, taught, how) {
  if (moment.outing) return null;
  const l = LESSONS.find((x) => !taught.has(x.key) && x.when(moment));
  return l ? { key: l.key, text: l.text(how), now: !!l.now } : null;
}

// What's been taught, from storage (bad or missing storage teaches again).
export function loadTaught(storage) {
  try {
    const list = JSON.parse(storage.getItem(TAUGHT_KEY));
    return new Set(Array.isArray(list) ? list.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveTaught(storage, taught) {
  try { storage.setItem(TAUGHT_KEY, JSON.stringify([...taught])); } catch {}
}

// The controls named for how you're playing.
export function howTo(phone) {
  return phone
    ? { lean: 'turn the phone to lean' }
    : { lean: 'lean with A and D (or the right stick)' };
}

// Instructions waiting for the hint lane, oldest first (main.js show()): one
// that comes while a longer hint is up waits its turn behind any already
// waiting, not in place of them (with one slot, the race's own hints could
// drop it unseen: a wash hint arriving under "Stuck?" took the slot). The same
// words aren't queued twice, and at most WAITING wait: when they're full, the
// newest is left out (owner via lead, 2026-11-19: an instruction the player
// hasn't seen matters more than a hint that will come again; dropping the
// oldest pushed one out unseen). A `now` hint never waits, so is never left
// out. Only the waiting keep their order: a hint no shorter than what's left
// of the one up goes straight up, unless that one is an instruction just up
// (`waits`). `at` is when it came, in game seconds.
// (Those past their moment are dropped first, by the newcomer's time: three
// stale ones held the places and turned a fresh one away.)
export const WAITING = 3;
export function waitTurn(queue, hint) {
  const fresh = queue.filter((h) => !(hint.at - h.at > STALE));
  if (fresh.length >= WAITING || fresh.some((h) => h.text === hint.text)) return fresh;
  return [...fresh, hint];
}
// Whether a hint (`hold` seconds, `now` or not) waits rather than going up over
// the one in the lane (`lane`: its `left` seconds, its `hold` and how long it's
// been `up`; null when the lane is clear). A shorter one never wipes a longer;
// and nothing but a `now` covers an instruction (`hold` ≥ 1) in its first READ
// seconds: the race's sprint hint once went up over a waiting instruction the
// frame it came off the queue, so it was never seen (games in webkit, 7d000bad).
export const READ = 0.5;
export function waits({ text, hold, now }, lane) {
  if (now || !lane || lane.left <= 0) return false;
  return lane.left > hold || (lane.hold >= 1 && lane.up < READ && lane.text !== text);
}
// The next to show at game time `now`, skipping any that waited past STALE
// seconds ("Your start in 10" or "The swan won't move" are about a moment).
export const STALE = 10;
export function nextTurn(queue, now) {
  const fresh = queue.filter((h) => now - h.at <= STALE);
  return { next: fresh[0] ?? null, rest: fresh.slice(1) };
}
