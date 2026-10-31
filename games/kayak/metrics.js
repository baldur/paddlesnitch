// What we learn from play, as analytics events (sent by ../shared/analytics.js
// to the site's /att/api/track, batched): how long people play, what they
// pick, and what they do. Never who: no names, no colours, no skin tone, only
// the choices and counts below, with the page's random per-tab session id.
//
// Three events, each at most 10 short string props (the endpoint's cap):
// - game_play: one per race, outing or drill, when it ends.
// - game_kit: your paddler and boat's choices, when play starts and they've
//   changed since last sent.
// - game_session: seconds played since the last send (sum per session for its
//   length), plays, how you came in, the walk's places, the controls used.
// Every value is lower-case words, numbers or a comma list, at most 60
// characters (the endpoint drops anything else), and empty ones are left out.
// Pure: no DOM; main.js feeds it and hands the events to the sender.

const round = (x, step = 1) => String(Math.round(x / step) * step);

// A race, outing or drill starting. `mode` is main.js's mode, `format` 'mass'
// or 'interval', `live` whether it's a live race, `from` 'walk' or 'menu'.
export function beginPlay(mode, { format = 'mass', live = false, from = 'menu', now = 0 } = {}) {
  const kind = mode.outing ? 'outing' : mode.drill ? 'drill' : live ? 'live' : mode.solo ? 'practice' : format === 'interval' ? 'trial' : 'race';
  return { mode: kind, course: mode.outing ?? mode.drill ?? mode.key, from, start: now, knocked: 0, bumps: 0, metres: 0 };
}

// The play's event when it ends: `end` 'finished', 'quit' (back to the menu),
// 'restart' or 'closed' (the page was left); `place` in a race, `swims` your capsizes.
/** @param {{ end: string, now: number, place?: number | null, swims?: number }} how */
export function playEvent(play, how) {
  const { end, now, place = null, swims = 0 } = how;
  const props = {
    mode: play.mode, course: play.course, end, secs: round(Math.max(0, now - play.start)),
    swims: String(swims), from: play.from,
  };
  if (place) props.place = String(place);
  if (play.mode === 'outing') {
    Object.assign(props, { knocked: String(play.knocked), bumps: String(play.bumps), km: (play.metres / 1000).toFixed(1) });
  }
  return { event: 'game_play', props };
}

// Your paddler and boat as choices (kit.js); null when nothing changed since
// `last` (the key of what was sent before).
export const KIT_FIELDS = ['body', 'hair', 'hat', 'beard', 'aid', 'glasses', 'sleeves', 'boat', 'paddle', 'shape'];
export function kitEvent(kit, last = null) {
  const props = {
    body: kit.body, hair: kit.hair, hat: kit.hat, beard: kit.beard, aid: String(kit.aid), glasses: kit.glasses,
    sleeves: kit.sleeves, boat: kit.boat, paddle: kit.paddle, shape: `${kit.deckShape}-${kit.hullShape}`,
  };
  const key = KIT_FIELDS.map((k) => props[k]).join(',');
  return key === last ? null : { event: 'game_kit', props, key };
}

// A visit: time is counted only while the page is in view.
export function createSession(now, from) {
  return { from, since: now, visible: true, secs: 0, plays: 0, places: new Set(), inputs: new Set() };
}
export function setVisible(session, visible, now) {
  if (session.visible) session.secs += now - session.since;
  session.visible = visible;
  session.since = now;
}

// What the visit did since the last send; starts counting afresh. Null if
// there's nothing new (under a second in view and no plays).
export function sessionEvent(session, now, gpu = '') {
  setVisible(session, session.visible, now);
  if (session.secs < 1 && !session.plays) return null;
  const props = { secs: round(session.secs), plays: String(session.plays), from: session.from };
  if (session.places.size) props.places = [...session.places].join(',');
  if (session.inputs.size) props.input = [...session.inputs].sort().join(',');
  if (gpu) props.gpu = gpu;
  session.secs = 0;
  session.plays = 0;
  return { event: 'game_session', props };
}
