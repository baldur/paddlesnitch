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
    when: (m) => !m.scull && m.draft > 0.3,
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
