import { BOAT, HULLS, strokeRate } from './sim.js';
import { loadCourse, riverView } from './course.js';
import { createRace, stepRace, standings, elapsed, projected, applyCall, released, DIVISION_9, DIVISION_3 } from './race.js';
import { call, whoAmI, SIGN_IN } from './account.js';
import { joinLive } from './live.js';
import { courseMap, headingDegrees, closeUp, follow } from './map.js';
import { BOATS, boatById, hullOf, hullFor, describe } from './boats.js';
import { PLACES, START, DOOR_LABELS, firstPlace, clubShots, clubMesh, legsMesh, glide, confusedSwan, swanLegsMesh, SWAN_LEGS, SWAN_SIZE, bridgeSwanMesh, ERGS, MY_ERG } from './club.js';
import { SCULLS, SCULL_COLOURS, scullById, scullRate, scullPose, split, easeLook, LOOK_KEYS, lookFromKeys } from './scull.js';
import { createErg, stepErg, monitor, ergPose, ergResult } from './erg.js';
import { SKIN_TONES, cleanKit, randomKit, livery, kitKey, moveOldScull, boardHull, isScullHull, scullHullName } from './kit.js';
import { beginPlay, playEvent, kitEvent, createSession, setVisible, sessionEvent } from './metrics.js';
import { paddlerSvg, boatSvg, sectionSvg, paddleSvg, clubSvg } from './picture.js';
import { encodeState, decodeState, createTrack, receive, sample, applyState, SEND_HZ } from './net.js';
import { buildWorld, groundAt } from './world.js';
import { DRILLS, setupDrill, trackDrill } from './drills.js';
import { OUTINGS, startOuting, stepOuting, tripBoatMesh, launchMesh } from './outing.js';
import { kayakMesh, kayakerMesh, paddleMesh, paddlerMesh, limbMesh, swanMesh, duckMesh, scullerMesh, eightMesh, cruiserMesh, motorboatMesh, swimmerMesh, oarMesh, ROWLOCKS, SEAT, shoulderOf, scullHullMesh, ergMesh, ergSeatMesh, ergHandleMesh, SCULL_SEAT, SCULL_FEET, SCULL_COACH, SCULL_ROWLOCK, ERG_SIZE } from './meshes.js';
import { TRAFFIC, overturned } from './traffic.js';
import { createRenderer } from './render.js';
import { perspective, view, basis, multiply, translation, rotationX, rotationY, rotationZ } from './mat4.js';
import { Controls, BUTTON, TILT_REFLEX, TILT_FULL, TILT_SETTLE } from './controls.js';
import { tone, noise, isMuted, setMuted } from '../shared/audio.js';
import { openDialog, gamepadDialogs, soundToggle } from '../shared/dialogs.js';

const STEP = 1 / 120;
const EYE_HEIGHT = 0.78;
const ROW_WIDE = 105; // degrees across, at least, sat in a scull
const FOV_Y = (62 * Math.PI) / 180;
const MIN_FOV_X = (75 * Math.PI) / 180;
const HULL_KEY = 'snitchmedia:kayak:hull'; // the hull picked before there were boats
const KIT_KEY = 'snitchmedia:kayak:kit';
const FORM_KEY = 'snitchmedia:kayak:form'; // sessionStorage: this visit only, for now
const FORMAT_KEY = 'snitchmedia:kayak:format'; // a race or a time trial, as last picked
// The rowing club's: your scull and its colour, and your best on the ergs (on
// this device for now: the account keeps the kayak's kit).
const ROW_KEY = 'snitchmedia:kayak:row'; // where the scull was kept before it went in the kit
const ERG_BEST = 'snitchmedia:kayak:erg';

// The courses, all on the one real river at Reading (courses/*.json, made by
// apps/web/scripts/courses: see docs/features/game-courses-from-video.md),
// loaded when first picked. Each is a race (everyone off together) or a time
// trial (interval starts), as picked on the menu; practice is on your own.
const MODES = {
  loop: { file: 'courses/loop.json', rivals: DIVISION_9, label: 'Time Trial Loop' },
  hasler79: { file: 'courses/hasler79.json', rivals: DIVISION_9, label: 'Hasler Div 7-9' },
  hasler16: { file: 'courses/hasler16.json', rivals: DIVISION_3, label: 'Hasler Div 1-6' },
  practice: { file: 'courses/practice.json', rivals: [], label: 'Practice', solo: true },
};
for (const [key, m] of Object.entries(MODES)) m.key = key;
const FORMATS = { mass: 'race', interval: 'time trial' };
let format = 'mass';
try { if (FORMATS[localStorage.getItem(FORMAT_KEY)]) format = localStorage.getItem(FORMAT_KEY); } catch {}
// Your best on a course, per format (the loop's time trial keeps the key it always had).
const bestKey = (m, f) => (m.solo || f === 'interval' ? `snitchmedia:kayak:${m.key}` : `snitchmedia:kayak:${m.key}:race`);
const formatOf = (m) => (m.head ? 'interval' : m.solo || liveRace ? 'mass' : format);
// Practice drills (drills.js), each on one of the courses above: starts, wash
// hanging and the portage. Picked from the practice page of the menu.
const DRILL_MODES = {
  'drill-start': { drill: 'start', label: 'Practice starts' },
  'drill-wash': { drill: 'wash', label: 'Practice wash hanging' },
  'drill-portage': { drill: 'portage', label: 'Practice the portage' },
};
for (const [key, m] of Object.entries(DRILL_MODES)) Object.assign(m, { key, solo: true, rivals: DRILLS[m.drill].rivals, base: MODES[DRILLS[m.drill].course] });
const DRILL_BEST = (m) => `snitchmedia:kayak:drill:${m.drill}`;
// Outings from Caversham Pier (outing.js), picked on the walk's bridge: on the
// Div 1-6 course's river, which goes all the way up to Mapledurham.
const OUTING_MODES = Object.fromEntries(Object.entries(OUTINGS).map(([key, o]) => [key, { key, outing: key, label: o.label, solo: true, rivals: [], base: MODES.hasler16 }]));
// The rowing club's (scull.js): a practice row, and the Head of the River on
// the Time Trial Loop (a head race is a time trial: boats sent off one at a
// time), the rivals in sculls. One way to row: a single scull.
const ROW_MODES = {
  'row-practice': { label: 'Practice row', line: '1 km up from the club, on your own', base: MODES.practice, solo: true, rivals: [] },
  'row-head': { label: 'Head of the River', line: 'Round the islands against the clock, scullers 30 seconds apart', base: MODES.loop, rivals: DIVISION_9.slice(0, 5), head: true },
};
for (const [key, m] of Object.entries(ROW_MODES)) Object.assign(m, { key, row: true });
// Your scull and its colour are in the kit (kit.js), so they follow you on the account.
// Anyone can paddle practice and the drills, and row; the kayak races, the leaderboard and live races need an account.
const OPEN = new Set(['practice', ...Object.keys(DRILL_MODES), ...Object.keys(OUTING_MODES), ...Object.keys(ROW_MODES)]);
// #debug (playtests), #tilt (the sensor readout), #race=CODE (a live race link).
const HASH = new URLSearchParams(location.hash.slice(1));
// The walk to the club (club.js) is what opens (owner 2026-10-31). #menu opens
// the menu instead, and a #race= link goes straight to its live race. No
// graphics, no walk: the menu says why.
let walking = !HASH.has('menu') && !HASH.has('race');

// The computer rivals' boat and club colours (the first was the player's,
// before you chose your own).
const LIVERIES = [
  { deck: [0.9, 0.2, 0.16], hull: [0.95, 0.93, 0.88], stripe: [0.97, 0.97, 0.95] },
  { deck: [0.12, 0.35, 0.8], hull: [0.95, 0.95, 0.95], stripe: [0.95, 0.85, 0.2], top: [0.95, 0.8, 0.15], skin: [0.85, 0.65, 0.5], cap: [0.1, 0.25, 0.7] },
  { deck: [0.95, 0.95, 0.92], hull: [0.92, 0.92, 0.9], stripe: [0.1, 0.6, 0.4], top: [0.1, 0.55, 0.35], skin: [0.6, 0.42, 0.3], cap: [0.95, 0.95, 0.95], body: 'curvy', hair: 'ponytail', hairColour: [0.35, 0.2, 0.1], hat: 'visor' },
  { deck: [0.98, 0.75, 0.1], hull: [0.95, 0.93, 0.88], stripe: [0.2, 0.2, 0.2], top: [0.15, 0.15, 0.18], skin: [0.92, 0.75, 0.62], cap: [0.98, 0.75, 0.1] },
  { deck: [0.55, 0.15, 0.6], hull: [0.95, 0.95, 0.95], stripe: [0.95, 0.95, 0.95], top: [0.6, 0.2, 0.65], skin: [0.75, 0.55, 0.4], cap: [0.95, 0.95, 0.95], hair: 'crop', hairColour: [0.1, 0.08, 0.06], beard: 'beard', hat: 'none' },
  { deck: [0.1, 0.1, 0.12], hull: [0.9, 0.9, 0.88], stripe: [0.9, 0.2, 0.2], top: [0.85, 0.15, 0.15], skin: [0.42, 0.28, 0.2], cap: [0.1, 0.1, 0.1], body: 'slim', hair: 'bun', hairColour: [0.08, 0.06, 0.05], hat: 'none' },
  { deck: [0.2, 0.7, 0.85], hull: [0.95, 0.95, 0.95], stripe: [0.95, 0.95, 0.95], top: [0.95, 0.95, 0.95], skin: [0.9, 0.72, 0.58], cap: [0.2, 0.7, 0.85] },
  { deck: [0.95, 0.45, 0.1], hull: [0.95, 0.93, 0.88], stripe: [0.1, 0.1, 0.1], top: [0.3, 0.3, 0.32], skin: [0.88, 0.68, 0.55], cap: [0.95, 0.45, 0.1] },
  { deck: [0.85, 0.85, 0.82], hull: [0.92, 0.92, 0.9], stripe: [0.8, 0.1, 0.3], top: [0.8, 0.1, 0.3], skin: [0.7, 0.5, 0.38], cap: [0.85, 0.85, 0.82], body: 'curvy', hair: 'ponytail', hairColour: [0.75, 0.6, 0.35] },
  { deck: [0.15, 0.45, 0.2], hull: [0.95, 0.95, 0.95], stripe: [0.95, 0.95, 0.95], top: [0.95, 0.6, 0.1], skin: [0.9, 0.74, 0.62], cap: [0.15, 0.45, 0.2] },
  { deck: [0.3, 0.3, 0.75], hull: [0.95, 0.93, 0.88], stripe: [0.95, 0.4, 0.1], top: [0.3, 0.3, 0.75], skin: [0.5, 0.34, 0.24], cap: [0.95, 0.4, 0.1], body: 'slim', hair: 'long', hairColour: [0.1, 0.07, 0.05], hat: 'visor' },
  { deck: [0.98, 0.9, 0.3], hull: [0.95, 0.95, 0.95], stripe: [0.2, 0.5, 0.9], top: [0.2, 0.5, 0.9], skin: [0.86, 0.66, 0.52], cap: [0.98, 0.9, 0.3] },
];

const canvas = document.getElementById('view');
const hud = document.getElementById('hud');
const menu = document.getElementById('menu');
const paused = document.getElementById('paused');
const finished = document.getElementById('finished');
const flash = document.getElementById('flash');
const live = document.getElementById('live');
const els = Object.fromEntries(['touchhelp', 'account', 'boards', 'boardlist', 'ranked', 'liveSetup', 'liveMakeTab', 'liveJoinTab', 'liveMake', 'liveJoinBox', 'liveCourse', 'liveCreate', 'liveCode', 'liveJoin', 'liveLobby', 'liveCodeShow', 'liveCourseShow', 'liveCopy', 'livePlayers', 'liveNote', 'liveStart', 'liveError', 'paddlerPic', 'skinTones', 'hairColour', 'hatColour', 'aid', 'aidColour', 'topColour', 'boatPic', 'sectionPic', 'paddlePic', 'glassesColour', 'deckColour', 'hullColour', 'shaftColour', 'bladeColour', 'stripeColour', 'boatList', 'youPic', 'youBoat', 'behind', 'cue', 'cueArrow', 'cueText', 'missed', 'map', 'near', 'clock', 'togo', 'pos', 'wash', 'place', 'speed', 'rate', 'stamina', 'flow', 'rhythm', 'needle', 'rudder', 'best', 'result', 'details', 'standings', 'nogpu', 'drill']
  .map((id) => [id, document.getElementById(id)]));

const controls = new Controls(canvas);

let state = 'menu'; // 'menu' | 'start' (on the line) | 'racing' | 'paused' | 'finished'
// Analytics (metrics.js, sent by ../shared/analytics.js): the visit, the play
// under way, and the paddler last reported.
const clock = () => performance.now() / 1000;
const visit = createSession(clock(), walking ? 'walk' : 'menu');
let play = null;
let kitSent = null;
const track = (e) => { if (e) window.gameMetrics?.track(e.event, e.props); };
function endPlay(end, extra = {}) {
  if (!play) return;
  track(playEvent(play, { end, now: clock(), ...extra }));
  play = null;
}
// The sender (a deferred script after this one in the page) is there by DOMContentLoaded.
const hookSender = () => window.gameMetrics?.beforeSend(() => track(sessionEvent(visit, clock(), renderer?.backend ?? '')));
if (window.gameMetrics) hookSender();
else addEventListener('DOMContentLoaded', hookSender, { once: true });
document.addEventListener('visibilitychange', () => setVisible(visit, !document.hidden, clock()));
addEventListener('pagehide', () => endPlay('closed'), { capture: true });
addEventListener('keydown', () => visit.inputs.add('keys'), { capture: true, passive: true });
addEventListener('pointerdown', (e) => visit.inputs.add(e.pointerType === 'touch' ? 'touch' : 'mouse'), { capture: true, passive: true });
let resumeTo = 'racing';
let mode = MODES.loop;
let race;
let drill = null; // the drill being practised (drills.js), if it's one
let liveries; // racer -> { key, ...colours } (kit.js livery, or one of LIVERIES)
// Your paddler and boat (kit.js): from this device, or new and random on a
// first visit; the account's copy replaces it once we know who you are.
let kit;
let kitChosen = false; // picked before, so the menu opens on the races
try {
  const saved = JSON.parse(localStorage.getItem(KIT_KEY));
  kitChosen = !!saved;
  kit = saved ? cleanKit(saved) : randomKit(Math.random, localStorage.getItem(HULL_KEY));
} catch {
  kit = randomKit();
}
// A scull picked before it went in the kit (on this device only) carries over, once.
{
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KIT_KEY)); } catch {}
  try { kit = moveOldScull(localStorage, kit, saved, { rowKey: ROW_KEY, kitKey: KIT_KEY }); } catch {}
}
const kits = new Map(); // the other players' kits in a live race, by player id
let renderer = null;
let meshes = null;
let placeNext = 0; // the next landmark to name (showPlace)
let placeTimer = 0;
let hints = { left: 3, wait: 8 }; // sprint tips still to give this race (sprintHint)
let stuck = { left: 2, for: 0, s: 0 }; // back-paddling tips still to give this race, and how long you've been getting nowhere (stuckHint)
const TOUCH_HELP = document.getElementById('touchhelp').textContent;
let hitSwan = -Infinity; // race time the player last paddled into a swan
let hitBoat = { kind: null, time: -Infinity }; // and into another boat
let behindTimer = 0; // hides the arrow for an eight coming up behind
let engineTimer = 0; // the next burst of a motorboat's engine
const BIRDS_DRAWN = 64; // of each kind

// --- race flow ---------------------------------------------------------------

function reset() {
  const f = form();
  race = createRace(mode.course, {
    rivals: mode.rivals,
    format: formatOf(mode),
    seed: liveRace?.seed ?? ((Math.random() * 2 ** 31) | 0),
    you: { hull: mode.row ? scullById(kit.scull).hull : hullOf(kit), power: 1 + f, endurance: 1 + f * 1.5 },
    live: liveRace && { players: liveRace.order, you: liveRace.room.you, host: liveRace.room.host },
    // A drill is about the one thing: no swans or other boats in the way.
    birds: !mode.drill, traffic: !mode.drill,
  });
  drill = mode.drill ? setupDrill(race, mode.drill) : null;
  // Practice also sharpens your feel for the beat.
  const h = race.player.boat.hull;
  if (!h.scull) race.player.boat.hull = { ...h, rhythmSlop: h.rhythmSlop * (1 + f * 2) };
  setLiveries();
  controls.clear();
  placeNext = 0;
  placeTimer = 0;
  cueNext = 0;
  cueTimer = 0;
  hints = { left: 3, wait: 8 };
  // Off from the rowing club's landing stage: don't name the canoe club across the river as you go.
  if (mode.row) placeNext = Math.max(0, (mode.course.scenery?.places ?? []).findIndex((p) => p.s > mode.course.start + 40));
  stuck = { left: 2, for: 0, s: 0 };
}

// Each boat's colours: yours, a friend's in a live race (in their boat), or a
// computer rival's.
function setLiveries() {
  let next = 1;
  liveries = new Map(race.racers.map((r) => {
    const k = r === race.player ? kit : r.remote && kits.get(r.id);
    if (!k) {
      const i = next++;
      return [r, { key: `rival${i}`, ...LIVERIES[i] }];
    }
    if (r.remote) r.boat.hull = hullOf(k);
    return [r, { key: kitKey(k), ...livery(k) }];
  }));
}

function start() {
  endPlay('restart');
  play = beginPlay(mode, { format: formatOf(mode), live: !!liveRace, from: visit.from, now: clock() });
  visit.plays++;
  const k = kitEvent(kit, kitSent);
  if (k) { track(k); kitSent = k.key; }
  reset();
  controls.calibrate();
  state = 'start';
  hud.hidden = false;
  hud.classList.toggle('solo', race.racers.length === 1);
  drawMap();
  // A drill that starts under way (wash hanging, the portage) has no starter.
  if (drill && race.start.phase === 'go') state = 'racing';
  // Rowing: the stroke coach and the Look buttons instead of the rudder and the paddler's hints.
  hud.classList.toggle('rowing', !!mode.row);
  els.touchhelp.textContent = mode.row
    ? "Left thumb, left oar; right thumb, right oar · Both together to go straight · Lead with one, or use one alone, to turn · Tap Look to glance over that shoulder, or hold it"
    : TOUCH_HELP;
  // Rowing on a keyboard or a pad (a phone has its own help line): how, once, at the start.
  if (mode.row && !phone.matches) show('← → (or LT, RT) are your oars: both together for a stroke, lead with one to turn. Hold Q or E (X or B on a pad) to look over your left or right shoulder', { small: true, hold: 6 });
  // An outing from Caversham Pier: no starter, no clock; off at once.
  hud.classList.toggle('outing', !!mode.outing);
  document.getElementById('outingBar').hidden = !mode.outing;
  if (mode.outing) {
    const bridge = race.course.scenery?.bridges?.find((b) => b.name === 'Caversham Bridge');
    startOuting(race, mode.outing, (bridge?.s ?? 0) + 30, (Math.random() * 2 ** 31) | 0);
    outingLever = 0;
    state = 'racing';
    showOutingBar();
    show(OUTINGS[mode.outing].label, { small: true, hold: 2.5 });
  }
  if (race.format === 'interval') {
    show(`Time trial: boats go one at a time, 30 seconds apart. You're ${ordinal(race.racers.indexOf(race.player) + 1)} off`, { small: true, hold: 5 });
  }
}

function pause() {
  if (state !== 'racing' && state !== 'start') return;
  // A live race can't start again for one player alone.
  paused.querySelector('button[value="restart"]').hidden = !!liveRace;
  resumeTo = state;
  state = 'paused';
  openDialog(paused);
}

// Session form: every race paddled makes you a little stronger, fitter and
// steadier on the beat, up to about 10%. Only for this visit, for now.
function training() {
  try { return JSON.parse(sessionStorage.getItem(FORM_KEY)) ?? { km: 0, races: 0 }; } catch { return { km: 0, races: 0 }; }
}
function form() {
  return 0.1 * (1 - Math.exp(-training().km / 6));
}
function train(km) {
  const t = training();
  t.km += km;
  t.races++;
  try { sessionStorage.setItem(FORM_KEY, JSON.stringify(t)); } catch {}
}

// Race time as shown: stretched by the course's warp (see course.js).
const shown = (t) => t * mode.course.warp;

function loadBest() {
  try { return JSON.parse(localStorage.getItem(bestKey(mode, formatOf(mode)))) ?? null; } catch { return null; }
}

function finish() {
  state = 'finished';
  const table = standings(race);
  const place = table.indexOf(race.player) + 1;
  const time = shown(race.player.finish);
  const solo = race.racers.length === 1;
  let best = loadBest();
  if (typeof best === 'number') best = { time: best }; // stage 1 stored a bare time
  const record = !best || time < best.time;
  if (record || (!solo && place < (best.place ?? Infinity))) {
    best = { time: Math.min(time, best?.time ?? Infinity), place: Math.min(place, best?.place ?? Infinity) };
    try { localStorage.setItem(bestKey(mode, formatOf(mode)), JSON.stringify(best)); } catch {}
  }

  submitResult(time);
  endPlay('finished', { place: solo ? null : place, swims: race.player.boat.capsizes });
  const before = form();
  train((mode.course.finish - mode.course.start) / mode.course.speedup / 1000);
  const gained = form() - before;

  const caps = race.player.boat.capsizes;
  const capsText = caps ? `${caps} capsize${caps > 1 ? 's' : ''}` : 'no capsizes';
  if (solo) {
    els.result.textContent = record ? `New best: ${formatTime(time)}` : `Finished in ${formatTime(time)}`;
    els.details.textContent = `Best ${formatTime(best.time)}, ${capsText}.`;
  } else {
    els.result.textContent = place === 1 ? 'You won!' : `You came ${ordinal(place)}`;
    els.details.textContent = `${formatTime(time)}, ${capsText}. Best ${ordinal(best.place)}, ${formatTime(best.time)}.`;
  }
  els.details.textContent += ` Form up ${(gained * 100).toFixed(1)}% to +${(form() * 100).toFixed(1)}%.`;
  // Rivals still out on the course get the time they're on track for.
  els.standings.replaceChildren(...table.map((r) => {
    const li = document.createElement('li');
    const t = race.format === 'interval' ? projected(race, r)
      : r.finish ?? race.time + (mode.course.finish - r.loc.s) / (Math.max(r.boat.speed, 2) * mode.course.speedup);
    li.textContent = `${r.name} ${formatTime(shown(t), 0)}`;
    if (r === race.player) li.className = 'you';
    return li;
  }));
  els.standings.hidden = solo;
  finished.querySelector('button[value="again"]').hidden = !!liveRace;
  tone({ freq: 523, to: 1046, duration: 0.5, type: 'triangle', gain: 0.15 });
  setTimeout(() => { if (state === 'finished') openDialog(finished); }, 1500);
}

// A go at a drill is over: how it went, your best, and Again to go again.
function finishDrill() {
  state = 'finished';
  endPlay('finished', { swims: race.player.boat.capsizes });
  const { title, lines, best } = drill.result;
  let before = null;
  try { before = JSON.parse(localStorage.getItem(DRILL_BEST(mode))); } catch {}
  const record = typeof before !== 'number' || best < before;
  if (record) try { localStorage.setItem(DRILL_BEST(mode), JSON.stringify(best)); } catch {}
  els.result.textContent = record && before !== null ? `New best! ${title}` : title;
  els.details.textContent = lines.join('. ') + '.';
  els.standings.hidden = true;
  finished.querySelector('button[value="again"]').hidden = false;
  tone({ freq: 523, to: 1046, duration: 0.5, type: 'triangle', gain: 0.15 });
  setTimeout(() => { if (state === 'finished') openDialog(finished); }, 1200);
}

function toMenu() {
  endPlay('quit', { swims: race?.player.boat.capsizes ?? 0 });
  endLive();
  state = 'menu';
  hud.hidden = true;
  reset();
  const lines = Object.values(MODES).flatMap((m) => (m.solo ? ['mass'] : ['mass', 'interval']).map((f) => {
    let b;
    try { b = JSON.parse(localStorage.getItem(bestKey(m, f))); } catch {}
    if (b == null) return '';
    if (typeof b === 'number') b = { time: b };
    return m.solo ? `${m.label} best: ${formatTime(b.time)}` : `${m.label} ${FORMATS[f]} best: ${ordinal(b.place)}, ${formatTime(b.time)}`;
  }));
  const t = training();
  if (t.races) lines.push(`Form this session: +${(form() * 100).toFixed(1)}% after ${t.races} race${t.races > 1 ? 's' : ''}`);
  els.best.textContent = lines.filter(Boolean).join(' · ');
  if (walking) return enterClub();
  showStep(kitChosen ? 'home' : 'paddler');
  openDialog(menu);
}

// --- the start menu: your paddler, your boat, then a race --------------------------

// Home: you, the races, the leaderboards. A first visit goes through making
// your paddler, boat and paddle first (Next, Next, Done); after that each is
// one tap from home, and its button says Done.
const STEPS = { home: 'stepHome', paddler: 'stepPaddler', boat: 'stepBoat', paddle: 'stepPaddle', boards: 'stepBoards', practice: 'stepPractice' };
function showStep(name) {
  // The menu's own home and its Leaderboards are the canoe club's.
  if (name === 'home') boardModes = null;
  if (name === 'boards') labelBoards();
  // Getting as far as the races counts as having chosen.
  if (name === 'home' && !kitChosen) {
    kitChosen = true;
    storeKit();
  }
  for (const [step, id] of Object.entries(STEPS)) document.getElementById(id).hidden = step !== name;
  // Named by its step's heading (the menu's own "Reading Thames" heading is hidden as a sheet).
  menu.setAttribute('aria-label', document.getElementById(STEPS[name])?.querySelector('h3')?.textContent || 'Reading Thames');
  for (const p of menu.querySelectorAll('.progress')) p.hidden = kitChosen || !!club;
  for (const b of menu.querySelectorAll('.step-buttons .next')) {
    b.innerHTML = kitChosen || club ? 'Done' : b.dataset.first;
  }
  menu.scrollTop = 0;
  if (name === 'boards') showBoards();
  drawKit();
}
for (const b of menu.querySelectorAll('[data-step]')) {
  b.addEventListener('click', () => {
    // In the club the editors are sheets over the room: Done puts them away.
    if (club && b.matches('.next')) {
      kitChosen = true;
      storeKit();
      return menu.close('');
    }
    // The rowing club's boards have no kayak plan behind them: Done puts them away.
    if (club && boardModes && b.closest('#stepBoards')) return menu.close('');
    showStep(b.matches('.next') && kitChosen ? 'home' : b.dataset.step);
  });
}

const make = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
};
els.skinTones.append(...SKIN_TONES.map((tone, i) => make(
  `<label><input type="radio" name="skin" value="${tone}" aria-label="Skin tone ${i + 1} of ${SKIN_TONES.length}"><span style="background:${tone}"></span></label>`)));
els.boatList.append(...BOATS.map((b) => make(
  `<label><input type="radio" name="boat" value="${b.id}"><b>${b.name}</b><span class="meter" aria-label="stability ${b.stability} of 9">${
    Array.from({ length: 9 }, (_, i) => `<i class="${i < b.stability ? 'on' : ''}"></i>`).join('')}</span><small>${describe(b)}</small></label>`)));

// The fields show the kit; any change to them is the new kit, kept at once.
function showKit() {
  for (const name of ['skin', 'body', 'hair', 'hat', 'beard', 'sleeves', 'glasses', 'boat', 'deckShape', 'hullShape', 'paddle']) {
    for (const input of menu.querySelectorAll(`input[name="${name}"]`)) input.checked = input.value === kit[name];
  }
  els.hairColour.value = kit.hairColour;
  els.hatColour.value = kit.hatColour;
  els.aid.checked = kit.aid;
  els.aidColour.value = kit.aidColour;
  els.topColour.value = kit.top;
  els.glassesColour.value = kit.glassesColour;
  els.deckColour.value = kit.deck;
  els.hullColour.value = kit.hullColour;
  els.shaftColour.value = kit.shaftColour;
  els.bladeColour.value = kit.bladeColour;
  els.stripeColour.value = kit.stripe;
  drawKit();
}
function drawKit() {
  els.paddlerPic.innerHTML = paddlerSvg(kit);
  els.youPic.innerHTML = paddlerSvg(kit);
  els.boatPic.innerHTML = boatSvg(kit);
  els.sectionPic.innerHTML = sectionSvg(kit);
  els.paddlePic.innerHTML = paddleSvg(kit);
  const b = boatById(kit.boat);
  const shape = [kit.deckShape === 'wings' && 'with wings', kit.hullShape === 'vee' && "a V'd keel"].filter(Boolean).join(' and ');
  els.youBoat.textContent = `You, in a ${b.name}${shape ? `, ${shape}` : ''} (stability ${b.stability} of 9), with a ${kit.paddle} paddle`;
}
const checked = (name) => menu.querySelector(`input[name="${name}"]:checked`)?.value;
menu.addEventListener('input', (e) => {
  if (!e.target.closest('#stepPaddler, #stepBoat, #stepPaddle')) return;
  kit = cleanKit({
    skin: checked('skin'), body: checked('body'),
    hair: checked('hair'), hairColour: els.hairColour.value, hat: checked('hat'), hatColour: els.hatColour.value,
    beard: checked('beard'), sleeves: checked('sleeves'), top: els.topColour.value,
    aid: els.aid.checked, aidColour: els.aidColour.value,
    glasses: checked('glasses'), glassesColour: els.glassesColour.value,
    boat: checked('boat'), deck: els.deckColour.value, hullColour: els.hullColour.value, stripe: els.stripeColour.value,
    deckShape: checked('deckShape'), hullShape: checked('hullShape'),
    paddle: checked('paddle'), shaftColour: els.shaftColour.value, bladeColour: els.bladeColour.value,
  }, kit);
  kitChosen = true;
  drawKit();
  storeKit();
});

// On this device straight away; on the account (signed in) once the picking settles.
let kitTimer = 0;
function storeKit() {
  try { localStorage.setItem(KIT_KEY, JSON.stringify(kit)); } catch {}
  clearTimeout(kitTimer);
  if (account.user) kitTimer = setTimeout(() => call('games.kit.set', kit, { mutation: true }).catch(() => {}), 800);
}
// Signed in: the account's kit wins (picked on another device, say); with none
// there yet, this device's goes up.
async function loadKit() {
  try {
    const saved = await call('games.kit.get');
    if (saved) {
      kit = cleanKit(saved, kit);
      try { localStorage.setItem(KIT_KEY, JSON.stringify(kit)); } catch {}
      // An account kit from before sculls were in it: this device's scull goes up to it.
      if (!saved.scull) storeKit();
      showKit();
      if (!kitChosen && state === 'menu' && !club) showStep('home');
      kitChosen = true;
    } else if (kitChosen) {
      storeKit();
    }
  } catch {}
}
showKit();

// Phones: the race buttons are the tap that lets us ask for the motion
// sensors, and for full screen held sideways where the browser allows it.
const phone = matchMedia('(pointer: coarse)');
menu.querySelector('form').addEventListener('click', (e) => {
  if (!e.target.closest('button') || !phone.matches) return;
  controls.enableTilt();
  // iOS only lets a page speak once it has spoken in response to a tap, so the
  // starter's voice needs a silent word now.
  if (window.speechSynthesis && !speechSynthesis.speaking) {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }
  if (document.fullscreenEnabled && !document.fullscreenElement) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }
});
// Leaving: out of full screen, then back to wherever you came from (the game
// may be hosted where ../ isn't a games list), or else to ../.
function leave() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (document.referrer && history.length > 1) history.back();
  else location.href = '../';
}
for (const link of document.querySelectorAll('a.leave')) {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    leave();
  });
}
// The phone's back gesture first takes you out of full screen: pause there,
// so the pause screen's Leave button is one tap away.
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) pause();
});

// Turned upright mid-race: pause, and the pause screen says to turn it back.
matchMedia('(orientation: portrait) and (pointer: coarse)').addEventListener('change', (e) => {
  if (e.matches) pause();
});

// A race or a time trial, for whichever course is picked next.
const formatButtons = [...menu.querySelectorAll('[data-format]')];
function showFormat() {
  for (const b of formatButtons) b.setAttribute('aria-pressed', String(b.dataset.format === format));
}
for (const b of formatButtons) {
  b.addEventListener('click', () => {
    format = b.dataset.format;
    try { localStorage.setItem(FORMAT_KEY, format); } catch {}
    showFormat();
  });
}
showFormat();

menu.addEventListener('cancel', (e) => e.preventDefault());
menu.addEventListener('close', () => {
  if (club) return planned(menu.returnValue);
  choose(menu.returnValue);
});
// Start a race, a drill or a live race by its menu value.
async function choose(value) {
  if (value === 'live') return openLive();
  const next = MODES[value] ?? DRILL_MODES[value] ?? OUTING_MODES[value] ?? ROW_MODES[value];
  if (!next) return;
  if (!OPEN.has(next.key) && !account.offline && !account.user) {
    location.href = SIGN_IN;
    return;
  }
  if (!next.course) {
    try {
      // A drill is on one of the courses: load it there, once.
      if (next.base) next.course = next.base.course ??= await loadCourse(next.base.file);
      else next.course = await loadCourse(next.file);
    } catch (err) {
      els.best.textContent = `${err.message} Check your connection and try again.`;
      if (!club) openDialog(menu);
      return;
    }
  }
  mode = next;
  if (!next.outing) try { localStorage.setItem(LAST_KEY, value); } catch {}
  leaveClub();
  if (renderer) useWorld();
  start();
}
paused.addEventListener('close', () => {
  if (paused.returnValue === 'leave') leave();
  else if (paused.returnValue === 'menu') toMenu();
  else if (paused.returnValue === 'restart') start();
  else state = resumeTo;
});
finished.addEventListener('close', () => {
  if (finished.returnValue === 'again') start();
  else toMenu();
});

document.getElementById('pause').addEventListener('click', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
soundToggle(document.getElementById('sound'), { isMuted, setMuted });
addEventListener('keydown', (e) => {
  if ((e.code === 'KeyP' || e.code === 'Escape') && (state === 'racing' || state === 'start')) {
    e.preventDefault();
    pause();
  }
});

function handleGamepad(pressed) {
  if (pressed.size) visit.inputs.add('pad');
  if (club && !live.open && (!menu.open || pressed.has(BUTTON.B))) return clubGamepad(pressed);
  if (race?.outing && state === 'racing') {
    if (pressed.has(BUTTON.UP) || pressed.has(7)) lever(1);
    if (pressed.has(BUTTON.DOWN) || pressed.has(6)) lever(-1);
  }
  if (pressed.has(BUTTON.START) && paused.open) {
    paused.close('resume');
    return;
  }
  // A room's sheet with nothing to press: the d-pad and A go to the room's labels.
  if (club && menu.open && !live.open) {
    if (!gamepadDialogs([menu], pressed)) clubGamepad(pressed);
    return;
  }
  if (!gamepadDialogs([menu, live, paused, finished], pressed) && pressed.has(BUTTON.START)) pause();
}

// --- outings from Caversham Pier (outing.js) -------------------------------------
//
// The river cruise (you stand at the bow; the arrows, a finger or the stick look
// about) and the hired launch (the arrows or the stick steer; up and down, or
// Faster and Slower, set the throttle in steps, as on a real boat).
const outingKeys = new Set();
let outingLever = 0; // the launch's throttle, -1 (astern) to 1, in quarters
const outingTouches = new Map(); // pointer id -> -1 (left half) or 1 (right half)
addEventListener('keydown', (e) => {
  if (!race?.outing || state !== 'racing') return;
  outingKeys.add(e.code);
  if (!e.repeat && (e.code === 'ArrowUp' || e.code === 'KeyW')) lever(1);
  if (!e.repeat && (e.code === 'ArrowDown' || e.code === 'KeyS')) lever(-1);
});
addEventListener('keyup', (e) => outingKeys.delete(e.code));
addEventListener('blur', () => outingKeys.clear());
canvas.addEventListener('pointerdown', (e) => {
  if (race?.outing) outingTouches.set(e.pointerId, e.clientX < canvas.clientWidth / 2 ? -1 : 1);
});
for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, (e) => outingTouches.delete(e.pointerId));
function lever(by) {
  if (race?.outing?.kind !== 'hire') return;
  outingLever = Math.max(-1, Math.min(1, outingLever + by * 0.25));
  showOutingBar();
}
document.getElementById('outingFaster').addEventListener('click', () => lever(1));
document.getElementById('outingSlower').addEventListener('click', () => lever(-1));
function showOutingBar() {
  const kind = race?.outing?.kind;
  if (!kind) return;
  document.getElementById('outingName').textContent = OUTINGS[kind].label;
  const hire = kind === 'hire';
  for (const id of ['outingFaster', 'outingSlower']) document.getElementById(id).hidden = !hire;
  document.getElementById('outingHint').textContent = hire
    ? (outingLever === 0 ? 'Stopped' : outingLever > 0 ? `Ahead ${outingLever * 4} of 4` : `Astern ${-outingLever * 4} of 4`) + (phone.matches ? ' · hold either side to steer' : ' · ← → steer, ↑ ↓ throttle')
    : phone.matches ? 'Hold either side to look about' : '← → look about';
}
function outingStep(dt) {
  let turn = 0;
  if (outingKeys.has('ArrowLeft') || outingKeys.has('KeyA')) turn -= 1;
  if (outingKeys.has('ArrowRight') || outingKeys.has('KeyD')) turn += 1;
  for (const side of outingTouches.values()) turn += side;
  const pad = navigator.getGamepads?.()?.find?.((p) => p);
  if (pad && Math.abs(pad.axes[0] ?? 0) > 0.2) turn += pad.axes[0];
  const was = [race.player.boat.x, race.player.boat.z];
  const events = stepOuting(race, dt, { turn, throttle: outingLever });
  if (play) play.metres += Math.hypot(race.player.boat.x - was[0], race.player.boat.z - was[1]) / (race.course.speedup ?? 1);
  for (const e of events) {
    if (play && e === 'bump') play.bumps++;
    if (play && e.startsWith('tipped-')) play.knocked++;
    if (e === 'end') {
      endPlay('finished');
      show('Mapledurham Lock: the end of the cruise', { hold: 4 });
      setTimeout(() => { if (race.outing && state === 'racing') toMenu(); }, 4500);
    }
    if (e === 'bump') noise({ freq: 160, to: 90, q: 2, duration: 0.25, gain: 0.12, type: 'lowpass' });
    if (e.startsWith('tipped-')) {
      noise({ freq: 900, to: 200, q: 0.7, duration: 0.6, gain: 0.2, type: 'lowpass' }); // the splash
      show(e === 'tipped-kayaker' ? 'You knocked a kayaker in!' : 'You knocked a rower in!', { small: true, hold: 2 });
    }
    if (e === 'swan') {
      outingLever = 0;
      showOutingBar();
      tone({ freq: 330, to: 260, duration: 0.25, type: 'square', gain: 0.06 });
      show("The swan won't move", { small: true, hold: 1.5 });
    }
  }
}

// --- the walk to the club (prototype, #club; club.js) ----------------------------
//
// Before a race you stand on the Thames at Reading: the path, Reading Canoe
// Club, its changing room, boathouse and clubhouse, and the pontoon. Each is a
// fixed camera shot; doors are labels over the scene, tapped (or Tab and Enter,
// or the d-pad and A). The kit editors and the plan open as sheets over the room.
const LAST_KEY = 'snitchmedia:kayak:last'; // the last race started, for "Race again"
const PLACE_KEY = 'snitchmedia:kayak:place'; // where you were on the walk
const clubEl = document.getElementById('club');
const clubDoors = document.getElementById('clubDoors');
const clubCards = document.getElementById('clubCards');
const clubNote = document.getElementById('clubNote');
const clubFade = document.getElementById('clubFade');
const clubBack = document.getElementById('clubBack');
const clubStart = document.getElementById('clubStart');
// Back goes up a level (a room or the pontoon to the club, the club to the
// bridge); Start over goes straight back to the bridge. Esc and a gamepad's B go back too.
const back = () => club && PLACES[club.place].up && go(PLACES[club.place].up);
clubBack.addEventListener('click', back);
clubStart.addEventListener('click', () => go(START));
addEventListener('keydown', (e) => {
  if (!club || live.open || state !== 'menu') return;
  // With a room's picker open, Esc goes back and Backspace does nothing (the
  // picker has no text to delete, and a browser would go back a page).
  if (menu.open && e.code === 'Backspace') return e.preventDefault();
  if (e.code !== 'Escape' && e.code !== 'Backspace') return;
  e.preventDefault();
  back();
});
const stillMotion = matchMedia('(prefers-reduced-motion: reduce)');
let club = null; // { shots, place, from, to, t, length, plan, spots }
const SWAN_SEED = Math.floor(Math.random() * 1000); // which way the bridge swan goes, different each visit

function enterClub() {
  const shots = clubShots(mode.course);
  if (!shots) return;
  let last = null;
  try { last = localStorage.getItem(PLACE_KEY); } catch {}
  const place = firstPlace({ last });
  club = { shots, place, from: null, to: null, t: 1, length: 0, plan: null, spots: [] };
  try { club.plan = localStorage.getItem(LAST_KEY); } catch {}
  menu.classList.add('sheet');
  clubEl.hidden = false;
  // Its labels and cards wait for the first frame of the scene behind them.
  if (!renderer) clubEl.classList.add('waiting');
  arrive(place);
}
function leaveClub() {
  if (!club) return;
  club = null;
  clubEl.hidden = true;
  menu.classList.remove('sheet');
  if (menu.open) menu.close('');
}

// Walk through a door: outside a glide, through a wall a quick fade.
function go(to) {
  if (!club || club.to || !PLACES[to] || to === club.place) return;
  closeSheet();
  endErg();
  const through = !!PLACES[to].inside !== !!PLACES[club.place].inside;
  club.from = clubCamera();
  club.to = to;
  club.t = 0;
  club.length = stillMotion.matches ? 0 : through ? 0.7 : 1.4;
  club.through = through;
  clubDoors.replaceChildren();
  clubNote.hidden = true;
}
function stepClub(dt) {
  if (!club.to) return;
  club.t = club.length ? Math.min(1, club.t + dt / club.length) : 1;
  clubFade.style.opacity = club.through ? String(1 - Math.abs(2 * club.t - 1)) : '0';
  if (club.t >= 1) {
    clubFade.style.opacity = '0';
    const to = club.to;
    club.to = null;
    arrive(to);
  }
}
function clubCamera() {
  const at = club.shots.places;
  if (!club.to) return at[club.place];
  if (club.through) return club.t < 0.5 ? club.from : at[club.to];
  return glide(club.from, at[club.to], club.t);
}

// In a place: its name, its doors and the things there to tap. The changing
// room, boathouse and clubhouse open their sheet as you come in.
function arrive(place) {
  club.place = place;
  visit.places.add(place);
  clubDoors.replaceChildren();
  clubCards.replaceChildren();
  clubBack.hidden = !PLACES[place].up;
  clubStart.hidden = !PLACES[place].up || PLACES[place].up === START;
  if (!PLACES[place].inside) try { localStorage.setItem(PLACE_KEY, place); } catch {}
  document.getElementById('clubPlace').textContent = PLACES[place].label;
  const { shots } = club;
  const label = (key) => (MODES[key] ?? DRILL_MODES[key] ?? ROW_MODES[key])?.label;
  // On the bridge the clubs are cards along the bottom, each with a picture,
  // and a pin over its building in the view: nothing covers the scene.
  const spots = place === 'path'
    ? [
      { card: { picture: clubSvg('canoe'), name: '<span class="long">Reading </span>Canoe Club', line: 'Kayak races and practice', pin: 'canoe' }, act: () => go('club') },
      { card: { picture: clubSvg('rowing'), name: '<span class="long">Reading </span>Rowing Club', line: 'Single sculls, the ergs and a head race', pin: 'rowing' }, act: () => go('rclub') },
      // From Caversham Pier, just below the bridge: a river cruise, or a boat to drive yourself.
      { card: { picture: clubSvg('cruise'), name: OUTINGS.cruise.label, line: OUTINGS.cruise.line }, act: () => choose('cruise') },
      { card: { picture: clubSvg('hire'), name: OUTINGS.hire.label, line: OUTINGS.hire.line }, act: () => choose('hire') },
      { pin: 'canoe', at: shots.doors.path.club },
      { pin: 'rowing', at: shots.doors.path.rclub },
    ]
    : PLACES[place].doors.map((to) => ({ label: PLACES[place].inside ? 'Back outside' : DOOR_LABELS[to], at: shots.doors[place][to], act: () => go(to), door: true }));
  if (place === 'path' && label(club.plan)) {
    spots.push({ card: { name: `Race again`, line: label(club.plan) }, act: () => choose(club.plan), go: true });
  }
  if (place === 'pontoon' || place === 'rpontoon') {
    const rowing = place === 'rpontoon';
    const plan = rowing ? (ROW_MODES[club.rplan] ? club.rplan : 'row-practice') : label(club.plan) && !ROW_MODES[club.plan] ? club.plan : 'practice';
    const shot = shots.places[place];
    spots.push({ label: `Push off: ${label(plan)}`, at: shot.look.map((v, i) => (i === 1 ? 1.2 : shot.eye[i] + (v - shot.eye[i]) * 0.08)), act: () => choose(plan), go: true });
  }
  // The rowing club: your all-in-one, the sculls, the plan, the ergs.
  if (place === 'rchanging') spots.push({ label: 'Change', at: shots.rChangeLabel, act: () => sheet('paddler') });
  if (place === 'rboathouse') {
    SCULLS.forEach((b, i) => spots.push({ label: b.name, at: shots.scullLabels[i], act: () => pickScull(b.id), on: kit.scull === b.id, scull: b.id }));
    spots.push({ label: 'Paint your scull', at: shots.paint, act: paintScull });
  }
  if (place === 'rclubhouse') {
    Object.entries(ROW_MODES).forEach(([key, m], i) => spots.push({ label: m.label, at: shots.rplan[i], act: () => plannedRow(key), on: club.rplan === key }));
    spots.push({ label: 'Honours board', at: shots.honours, act: honours });
  }
  // (Hidden while you row, where a tap would start again; then "Row again".)
  if (place === 'erg') spots.push({ label: 'Row a 500 m', at: shots.ergLabel, act: startErg, go: true, hideWhile: () => ergRun && ergRun.erg.done === null, erg: true });
  if (place === 'changing') spots.push({ label: 'Change', at: shots.changeLabel, act: () => sheet('paddler') });
  if (place === 'boathouse') {
    BOATS.forEach((b, i) => spots.push({ label: String(b.stability), at: shots.rackLabels[i], act: () => pickBoat(b.id), small: true, on: kit.boat === b.id, title: b.name }));
    spots.push({ label: 'Paint your boat', at: shots.rack[7].map((v, i) => (i === 1 ? v + 1.4 : v)), act: () => sheet('boat') });
    spots.push({ label: 'Paddles', at: shots.paddles, act: () => sheet('paddle') });
  }
  if (place === 'clubhouse') {
    spots.push({ label: 'The plan', at: shots.boards.plan, act: () => sheet('home') });
    if (!account.offline) spots.push({ label: 'Leaderboards', at: shots.boards.leaders, act: () => boards(null) });
  }
  club.spots = spots.map((spot) => {
    // A pin only marks a building; it isn't a control.
    if (!spot.act) {
      const pin = document.createElement('span');
      pin.className = `pin ${spot.pin}`;
      pin.setAttribute('aria-hidden', 'true');
      clubDoors.append(pin);
      return { ...spot, el: pin };
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = [spot.card ? 'card' : 'spot', spot.door && 'door', spot.go && 'go', spot.small && 'small', spot.on && 'on'].filter(Boolean).join(' ');
    if (spot.card) {
      const { picture = '', name, line, pin } = spot.card;
      b.innerHTML = `${picture}<span class="name">${pin ? `<i class="pin ${pin}"></i>` : ''}${name}</span><small>${line}</small>`;
    } else b.textContent = spot.label;
    if (spot.title) b.title = b.ariaLabel = `${spot.title}, stability ${spot.label} of 9`;
    b.addEventListener('click', () => {
      if (phone.matches) controls.enableTilt();
      spot.act();
    });
    (spot.card ? clubCards : clubDoors).append(b);
    return { ...spot, el: b };
  });
  menu.classList.toggle('rowing', place === 'rchanging');
  if (place === 'changing' || place === 'rchanging') sheet('paddler');
  if (place === 'clubhouse') sheet('home');
  // A first visit: where to make your paddler, and where the races are.
  if (place === 'club' && !kitChosen) note('New here? Make your paddler in the changing room, then pick a race in the clubhouse');
  // Phones held upright: races are sideways.
  if (place === 'pontoon' && matchMedia('(orientation: portrait) and (pointer: coarse)').matches) note('Turn your phone sideways to race');
  // Keyboard focus to the first thing to tap here (the door you used is gone), unless a sheet opened.
  if (!menu.open) club.spots.find((x) => x.act)?.el.focus({ preventScroll: true });
  if (place === 'rchanging') note("You row in an all-in-one, in your top's colour");
  if (place === 'erg') note(ergBest() ? `Your best 500 m: ${formatTime(ergBest())}` : 'Press both arrows, thumbs or triggers together for each stroke');
}
// The erg room: a 500 m on your erg, the rower on the next one keeping a
// steady 2:08. Both sides together for a stroke; the monitor shows how it's going.
let ergRun = null; // { erg, play }
const ergMon = document.getElementById('ergMon');
const ergBest = () => { try { return Number(localStorage.getItem(ERG_BEST)) || null; } catch { return null; } };
function startErg() {
  closeSheet();
  endErg('restart');
  controls.clear();
  ergRun = { erg: createErg({ pace: 128 }), play: beginPlay({ key: 'erg', solo: true }, { from: visit.from, now: clock() }) };
  visit.plays++;
  ergMon.hidden = false;
  note('Row! Press both sides together for each stroke. Steady beats quick.');
}
function endErg(end = 'quit') {
  if (!ergRun) return;
  if (ergRun.play) track(playEvent(ergRun.play, { end, now: clock() }));
  ergRun = null;
  ergMon.hidden = true;
}
function stepErgRun(dt) {
  const { erg } = ergRun;
  const { strokes } = controls.take();
  for (const e of stepErg(erg, dt, { strokes: strokes.filter((x) => !x.startsWith('back-')) })) {
    if (e === 'stroke') noise({ freq: 300, to: 120, q: 0.6, duration: 0.7, gain: 0.08 }); // the flywheel's whirr
    if (e === 'done') {
      const { text, record } = ergResult(erg.done, ergBest(), erg.other.metres);
      if (record) try { localStorage.setItem(ERG_BEST, String(erg.done)); } catch {}
      note(text);
      const again = club.spots.find((x) => x.erg);
      if (again) again.el.textContent = 'Row again';
      tone({ freq: 523, to: 1046, duration: 0.5, type: 'triangle', gain: 0.15 });
      track(playEvent(ergRun.play, { end: 'finished', now: clock() }));
      ergRun.play = null;
    }
  }
  const m = monitor(erg);
  ergMon.innerHTML = `<b>${formatTime(m.time)}</b><span>${m.pace ? formatTime(m.pace) : '-:--'}<small>/500</small></span><span>${m.rate || '--'}<small>spm</small></span><b>${m.left}<small>m to go</small></b><span class="other">Rower next to you: ${m.other ?? 0} m</span>`;
}

// The rowing club's boathouse: take a scull, or paint yours.
function pickScull(id) {
  kit = cleanKit({ ...kit, scull: id }, kit);
  kitChosen = true;
  storeKit();
  for (const s of club.spots) if (s.scull) s.el.classList.toggle('on', s.scull === id);
  note(`${scullById(id).name}: ${scullById(id).line}`);
}
function paintScull() {
  kit = cleanKit({ ...kit, scullColour: SCULL_COLOURS[(SCULL_COLOURS.indexOf(kit.scullColour) + 1) % SCULL_COLOURS.length] }, kit);
  kitChosen = true;
  storeKit();
}
function plannedRow(key) {
  club.rplan = key;
  go('rpontoon');
}
// The leaderboards as a sheet: the canoe club's courses (`modes` null), or the
// rowing club's. From the rowing club there's no kayak plan to go back to.
function boards(modes) {
  boardModes = modes;
  sheet('boards');
}
// The boards' heading and button: the rowing club's honours board (Done), or the leaderboards (back to the plan).
function labelBoards() {
  document.querySelector('#stepBoards h3').textContent = boardModes ? 'Honours board' : 'Leaderboards';
  document.querySelector('#stepBoards .back').innerHTML = boardModes ? 'Done' : '&larr; Back';
}
// The honours board: the rowing leaderboards (signed in, on the site), and your bests on this device.
function honours() {
  if (!account.offline) return boards(Object.values(ROW_MODES)); // your bests go at the top of it
  const lines = rowingBests();
  note(lines.length ? `Your bests on this device: ${lines.join(' · ')}` : 'No times yet: row the Head of the River, or a 500 m on the ergs.');
}
// Your rowing bests on this device: each course, and the erg's 500 m.
function rowingBests() {
  const lines = Object.values(ROW_MODES).map((m) => {
    let b = null;
    try { b = JSON.parse(localStorage.getItem(bestKey(m, formatOf(m)))); } catch {}
    return b?.time ? `${m.label}: ${formatTime(b.time)}` : '';
  }).filter(Boolean);
  if (ergBest()) lines.push(`Erg 500 m: ${formatTime(ergBest())}`);
  return lines;
}
function note(text) {
  clubNote.textContent = text;
  clubNote.hidden = false;
}
// A room's picker, beside the scene: not modal, so Back, Start over and the
// room's own labels still work while it's open (a modal dialog blocks them).
function sheet(step) {
  showStep(step);
  menu.returnValue = '';
  if (!menu.open) menu.show();
}
const closeSheet = () => { if (club && menu.open) menu.close(''); };
function pickBoat(id) {
  kit = cleanKit({ ...kit, boat: id }, kit);
  kitChosen = true;
  storeKit();
  showKit();
  setLiveries();
  for (const s of club.spots) if (s.small) s.el.classList.toggle('on', s.title === boatById(id).name);
  note(`${boatById(id).name}: ${describe(boatById(id))}`);
}
// The plan picked on the whiteboard: off to the pontoon to push off.
function planned(value) {
  if (value === 'live') return choose('live');
  if (!MODES[value] && !DRILL_MODES[value]) return;
  club.plan = value;
  go('pontoon');
}

// Each frame: the door labels over the points they name.
function placeDoors() {
  if (!viewProj) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const m = viewProj;
  const placed = [];
  for (const s of club.spots) {
    if (!s.at) continue;
    const [x, y, z] = s.at;
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
    const cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
    const show = cw > 0 && Math.abs(cx) < 1.1 && Math.abs(cy) < 1.1 && !s.hideWhile?.();
    s.el.hidden = !show;
    if (!show) continue;
    // Kept on the screen, 16 px in from its edges (a narrow phone's view is wider than it is).
    const half = (s.el.offsetWidth || 0) / 2;
    placed.push({ el: s.el, x: Math.max(16 + half, Math.min(w - 16 - half, ((cx + 1) / 2) * w)), y: ((1 - cy) / 2) * h, w: s.el.offsetWidth || 0, h: s.el.offsetHeight || 0 });
  }
  // Labels that would overlap (a narrow phone squeezes a club's doors together) move apart, downwards.
  placed.sort((a, b) => a.y - b.y);
  for (let i = 0; i < placed.length; i++) {
    for (let j = 0; j < i; j++) {
      const [a, b] = [placed[j], placed[i]];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 4 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + 4) b.y = a.y + (a.h + b.h) / 2 + 4;
    }
  }
  for (const p of placed) p.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
  // The erg's numbers, beside its monitor (above it, on a phone held sideways).
  if (ergRun && ergMonAt) {
    const [x, y, z] = ergMonAt;
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
    const cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
    const half = ergMon.offsetWidth / 2;
    const left = Math.max(16 + half, Math.min(w - 16 - half, ((cx + 1) / 2) * w));
    ergMon.style.transform = `translate(${left}px, ${((1 - cy) / 2) * h}px) translate(-50%, -165%)`;
  }
}
// The rooms, and you, your boats on the rack: built the first time, rebuilt when your kit changes.
function placeClub() {
  if (!meshes.club) {
    meshes.club = renderer.createMesh(clubMesh(club.shots));
    renderer.place(meshes.club, [translation(0, 0, 0)]);
    meshes.rack = new Map();
    meshes.legs = new Map();
    meshes.bridgeSwan = renderer.createMesh(bridgeSwanMesh());
    meshes.swanLegs = renderer.createMesh(swanLegsMesh());
  }
  // Your kit as it is now, so the picker's changes show at once.
  const l = { key: kitKey(kit), ...livery(kit) };
  const out = [meshes.club];
  // You, standing in the changing room, arms by your sides.
  const set = paddlerOf(l);
  const stand = basis([1, 0, 0], [0, 1, 0], [0, 0, 1], club.shots.changingStand); // facing north, towards the camera
  const legsKey = String(l.skin);
  if (!meshes.legs.has(legsKey)) meshes.legs.set(legsKey, renderer.createMesh(legsMesh(l.skin)));
  const legs = meshes.legs.get(legsKey);
  renderer.place(set.body, [stand]);
  const sh = shoulderOf(l.body);
  renderer.place(set.arms, [-1, 1].map((side) => limb(stand, [side * sh.x, sh.y, 0], [side * (sh.x + 0.07), sh.y - 0.62, -0.03])));
  renderer.place(legs, [stand]);
  out.push(set.body, set.arms, legs);
  // The confused swan on Caversham Bridge's parapet.
  const walk = club.shots.swan;
  if (walk) {
    const sw = confusedSwan(performance.now() / 1000, walk.side, SWAN_SEED);
    const dir = normalize([walk.to[0] - walk.from[0], 0, walk.to[2] - walk.from[2]]);
    const pos = walk.from.map((v, i) => v + (walk.to[i] - v) * sw.along);
    // Faces up or down the parapet or towards you; its head turns as it looks about.
    const a = Math.atan2(dir[0], -dir[2]) + sw.face + sw.look;
    const f = [Math.sin(a), 0, -Math.cos(a)];
    const big = SWAN_SIZE; // larger than life, so it shows from up on the bridge
    const lift = sw.stand * SWAN_LEGS * big;
    const tilt = 0.06 * sw.waddle;
    const rightV = [-f[2] * Math.cos(tilt), Math.sin(tilt), f[0] * Math.cos(tilt)];
    const upV = [f[2] * Math.sin(tilt), Math.cos(tilt), -f[0] * Math.sin(tilt)];
    const at = [pos[0], pos[1] + lift - 0.04 * (1 - sw.stand), pos[2]];
    const k = (v) => v.map((x) => x * big);
    renderer.place(meshes.bridgeSwan, [basis(k(rightV), k(upV), k(f.map((v) => -v)), at)]);
    renderer.place(meshes.swanLegs, sw.stand > 0.05 ? [basis(k(rightV), k(upV).map((v) => v * sw.stand), k(f.map((v) => -v)), at)] : []);
    out.push(meshes.bridgeSwan, meshes.swanLegs);
  }
  out.push(...placeRowingClub(l));
  // The nine boats on the boathouse's racks, side on, in your colours.
  BOATS.forEach((b, i) => {
    const key = `${l.key}:${b.id}`;
    if (!meshes.rack.has(key)) meshes.rack.set(key, renderer.createMesh(kayakMesh({ ...l, beam: hullFor(b.stability).beam })));
    const mesh = meshes.rack.get(key);
    renderer.place(mesh, [basis([0, 0, 1], [0, 1, 0], [-1, 0, 0], club.shots.rack[i])]);
    out.push(mesh);
  });
  return out;
}
// You in rowing kit: an all-in-one in your top's colour, bare arms, no buoyancy aid.
const suitOf = (l) => ({ ...l, key: `${l.key}:suit`, sleeves: 'none', aid: null });
// A leg or an arm's two pieces, `a` to `b` through a joint `length` from each
// that bends towards `up` (boat or erg space).
function bend(a, b, length, up) {
  const d = b.map((v, i) => v - a[i]);
  const dist = Math.min(Math.hypot(...d), length * 2 - 0.001);
  const h = Math.sqrt(length * length - (dist / 2) ** 2);
  const mid = a.map((v, i) => (v + b[i]) / 2);
  // Out of the line, towards `up`.
  const n = normalize(d);
  const k = up.reduce((acc, v, i) => acc + v * n[i], 0);
  const side = normalize(up.map((v, i) => v - n[i] * k));
  return mid.map((v, i) => v + side[i] * h);
}
// A rower on a slide (an erg's or a scull's), in that thing's space, facing -z
// on an erg (+z in a boat: `facing`). Hips at `hips`, feet at `feet`, hands on
// `hands` (one point for an erg's handle, or one per oar handle), leaning
// `lean` radians from upright towards where they face.
const legParts = new Map();
function rowerParts(model, l, { hips, feet, hands, lean, facing = -1 }) {
  const set = paddlerOf(l);
  const key = l.key;
  if (!legParts.has(key)) legParts.set(key, { thigh: renderer.createMesh(limbMesh(l.top), 4), shin: renderer.createMesh(limbMesh(l.skin), 4) });
  const legs = legParts.get(key);
  // The body: the paddler mesh faces -z; in a boat the rower faces +z, so turn it round.
  const turn = facing > 0 ? rotationY(Math.PI) : translation(0, 0, 0);
  const body = multiply(model, multiply(translation(...hips), multiply(turn, rotationX(-lean))));
  const sh = shoulderOf(l.body);
  const shoulder = (side) => apply(body, [side * sh.x, sh.y, 0]);
  const world = (p) => apply(model, p);
  const arms = [-1, 1].map((side, i) => {
    // (Turned to face +z, the shoulder at -x in the mesh is on the right: it takes the other handle.)
    const hand = Array.isArray(hands[0]) ? hands[facing > 0 ? 1 - i : i] : hands.map((v, k) => (k === 0 ? v + side * 0.18 * -facing : v));
    return limb(translation(0, 0, 0), shoulder(side), world(hand));
  });
  const thighs = [];
  const shins = [];
  for (const side of [-1, 1]) {
    const hip = [hips[0] + side * 0.09, hips[1], hips[2]];
    const foot = [feet[0] + side * 0.09, feet[1], feet[2]];
    const knee = bend(hip, foot, 0.47, [0, 1, 0]);
    thighs.push(limb(model, hip, knee));
    shins.push(limb(model, knee, foot));
  }
  renderer.place(set.body, [body]);
  renderer.place(set.arms, arms);
  renderer.place(legs.thigh, thighs);
  renderer.place(legs.shin, shins);
  return [set.body, set.arms, legs.thigh, legs.shin];
}

// The rowing club: you in your all-in-one in its changing room, the sculls on
// the boathouse rack, the ergs, you on yours (rowing, when you are) and the
// rower on the next one.
function placeRowingClub(l) {
  const shots = club.shots;
  const out = [];
  meshes.sculls ??= new Map();
  if (!meshes.erg) {
    meshes.erg = renderer.createMesh(ergMesh(), ERGS.length);
    meshes.ergSeat = renderer.createMesh(ergSeatMesh(), ERGS.length);
    meshes.ergHandle = renderer.createMesh(ergHandleMesh(), ERGS.length);
  }
  const suit = suitOf(l);
  // In the changing room: standing, arms by your sides, the all-in-one to mid-thigh.
  const set = paddlerOf(suit);
  const stand = basis([1, 0, 0], [0, 1, 0], [0, 0, 1], shots.rStand);
  const legsKey = `${l.skin}:${l.top}`;
  if (!meshes.legs.has(legsKey)) meshes.legs.set(legsKey, renderer.createMesh(legsMesh(l.skin, l.top), 2));
  const sh = shoulderOf(l.body);
  if (club.place === 'rchanging' || club.to === 'rchanging') {
    renderer.place(set.body, [stand]);
    renderer.place(set.arms, [-1, 1].map((side) => limb(stand, [side * sh.x, sh.y, 0], [side * (sh.x + 0.07), sh.y - 0.62, -0.03])));
    renderer.place(meshes.legs.get(legsKey), [stand]);
    out.push(set.body, set.arms, meshes.legs.get(legsKey));
  }
  // The sculls on the rack: yours in your colour, the others the club's white.
  const scullMesh = (hex) => {
    if (!meshes.sculls.has(hex)) meshes.sculls.set(hex, renderer.createMesh(scullHullMesh({ deck: rgbOf(hex), hull: rgbOf(hex).map((v) => v * 0.94) }), 3));
    return meshes.sculls.get(hex);
  };
  const byColour = new Map();
  SCULLS.forEach((b, i) => {
    const mesh = scullMesh(b.id === kit.scull ? kit.scullColour : SCULL_COLOURS[0]);
    if (!byColour.has(mesh)) byColour.set(mesh, []);
    byColour.get(mesh).push(basis([0, 0, 1], [0, 1, 0], [-1, 0, 0], shots.sculls[i]));
  });
  for (const [mesh, where] of byColour) {
    renderer.place(mesh, where);
    out.push(mesh);
  }
  // The ergs, side on, flywheels to your left; seats where they sit at rest.
  const ergAt = shots.ergs.map((p) => basis([0, 0, 1], [0, 1, 0], [-1, 0, 0], p));
  const NEXT = MY_ERG + 2;
  const seats = [];
  const handles = [];
  const rest = { slide: 0.05, arms: 0.4 };
  // Your pose (rowing, or sat ready), and the next erg's rower, steady at 24 a minute.
  const mine = ergRun ? ergPose(ergRun.erg) : rest;
  const t = performance.now() / 1000;
  const p = (t * 24 / 60) % 1;
  const smooth = (x) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
  const theirs = !ergRun ? rest : p < 0.35 ? { slide: 1 - smooth(p / 0.35 / 0.7), arms: 1 - smooth((p / 0.35 - 0.5) / 0.5) } : { slide: smooth(((p - 0.35) / 0.65 - 0.25) / 0.75), arms: smooth((p - 0.35) / 0.65 / 0.25) };
  const rowers = new Map([[MY_ERG, { pose: mine, l: suit }], [NEXT, { pose: theirs, l: { ...LIVERIES[3], key: 'erg-next', sleeves: 'none', body: 'slim', hair: 'ponytail', hairColour: [0.3, 0.2, 0.1], hat: 'none' } }]]);
  // (Only in the erg room: a body can stand in one place a frame, and yours is in the changing room too.)
  const inErgRoom = club.place === 'erg' || club.to === 'erg';
  ergAt.forEach((model, i) => {
    const r = inErgRoom ? rowers.get(i) : null;
    const pose = r?.pose ?? rest;
    const seatZ = 0.55 - pose.slide * 0.8;
    seats.push(multiply(model, translation(0, 0, seatZ)));
    if (!r) {
      handles.push(multiply(model, translation(0, 0.62, ERG_SIZE.handle - 0.15)));
      return;
    }
    const lean = 0.42 * pose.slide - 0.22 * (1 - pose.slide);
    const hips = [0, 0.5, seatZ];
    const body = multiply(translation(...hips), rotationX(-lean));
    const chest = apply(body, [0, 0.42, -0.12]);
    const handle = [0, chest[1] - 0.05, chest[2] - 0.18 - 0.42 * pose.arms];
    handles.push(multiply(model, translation(...handle)));
    out.push(...rowerParts(model, r.l, { hips, feet: [0, 0.4, ERG_SIZE.feet + 0.05], hands: handle, lean }));
  });
  renderer.place(meshes.erg, ergAt);
  renderer.place(meshes.ergSeat, seats);
  renderer.place(meshes.ergHandle, handles);
  out.push(meshes.erg, meshes.ergSeat, meshes.ergHandle);
  // Where your erg's monitor is, for its numbers.
  ergMonAt = apply(ergAt[MY_ERG], ERG_SIZE.monitor);
  return out;
}
let ergMonAt = null;
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

// A gamepad on the walk: the d-pad moves between the labels, A goes.
function clubGamepad(pressed) {
  if (pressed.has(BUTTON.B)) return back();
  const shown = club.spots.filter((s) => !s.el.hidden);
  if (!shown.length) return;
  const i = shown.findIndex((s) => s.el === document.activeElement);
  if (pressed.has(BUTTON.RIGHT) || pressed.has(BUTTON.DOWN)) shown[(i + 1) % shown.length].el.focus();
  if (pressed.has(BUTTON.LEFT) || pressed.has(BUTTON.UP)) shown[(i - 1 + shown.length) % shown.length].el.focus();
  if (pressed.has(BUTTON.A) && i >= 0) shown[i].el.click();
}

// --- account and leaderboards ---------------------------------------------------

let account = { user: null, offline: true }; // until the site answers

function link(text, href) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  return a;
}

function showAccount() {
  els.boards.hidden = account.offline;
  if (account.offline) return els.account.replaceChildren();
  if (account.user) {
    els.account.textContent = `Signed in as ${account.user.displayName || account.user.email}: your race times go on the leaderboards.`;
  } else {
    els.account.replaceChildren(link('Sign in', SIGN_IN), ' to race the courses, race friends and get on the leaderboards. Practice is open to everyone.');
  }
}

// A finished race's time goes on the course's leaderboard (signed in only).
async function submitResult(time) {
  els.ranked.textContent = '';
  if (!account.user) return;
  try {
    const { best, rank } = await call('games.submit', { course: mode.key, time, hull: boardHull(kit, !!mode.row) }, { mutation: true });
    els.ranked.textContent = best ? `A new best for you on the ${mode.label} leaderboard: ${ordinal(rank)}.`
      : rank ? `Your best on the ${mode.label} leaderboard is ${ordinal(rank)}.` : '';
  } catch {
    els.ranked.textContent = "Couldn't reach the leaderboard.";
  }
}

// The leaderboards page: the top ten on each course, with the boat each time
// was paddled in, and where you are if you're further down.
const SHOW = 10;
const boatName = (hull) => (isScullHull(hull) ? scullHullName(hull) : boatById(hull)?.name ?? HULLS[hull]?.name ?? hull);
// Which boards the leaderboards page shows: the canoe club's courses, or the rowing club's.
let boardModes = null;
async function showBoards() {
  els.boardlist.replaceChildren(make('<p>Loading…</p>'));
  const rowing = !!boardModes;
  const boards = await Promise.all((boardModes ?? Object.values(MODES)).map(async (m) => [m, await call('games.leaderboard', { course: m.key }).catch(() => null)]));
  const top = [];
  // The rowing club's: your bests on this device first, and how to get on the boards.
  if (rowing) {
    const mine = rowingBests();
    if (mine.length) top.push(make(`<p class="bests">Your bests on this device: ${mine.join(' · ')}</p>`));
    if (!account.user) {
      const p = document.createElement('p');
      p.append(link('Sign in', SIGN_IN), ' to put your times on the honours board.');
      top.push(p);
    }
  }
  // None of them loaded: one message, and a way to try again.
  if (boards.every(([, b]) => !b)) {
    const again = document.createElement('button');
    again.type = 'button';
    again.textContent = 'Try again';
    again.addEventListener('click', showBoards);
    const p = make(`<p>Couldn't load the ${rowing ? 'honours board' : 'leaderboards'}. </p>`);
    p.append(again);
    return els.boardlist.replaceChildren(...top, p);
  }
  els.boardlist.replaceChildren(...top, ...boards.map(([m, b]) => {
    const div = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = m.label;
    div.append(title);
    if (!b?.top.length) {
      div.append(!b ? "Couldn't load this course." : rowing ? 'No times yet: pick it on the whiteboard and row it.' : 'No times yet.');
      return div;
    }
    const table = document.createElement('table');
    const row = (e) => {
      const tr = document.createElement('tr');
      for (const text of [ordinal(e.rank), e.name, formatTime(e.time), boatName(e.hull)]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      if (e.you) tr.className = 'you';
      return tr;
    };
    table.append(...b.top.slice(0, SHOW).map(row));
    if (b.you && b.you.rank > SHOW) table.append(row({ ...b.you, name: 'You', you: true }));
    div.append(table);
    return div;
  }));
}

// --- live races -------------------------------------------------------------------
// Make or join a race (live.js connects to the relay), wait in the lobby, then
// the host starts it: everyone builds the same race (same seed and order) and
// each boat's state goes to the others 10 times a second (net.js).

let lobby = null; // the live.js connection, from the lobby to the end of the race
let liveRace = null; // { room, order, seed } once a live race has begun
const tracks = new Map(); // player id -> states received (net.js)
let sendTimer = 0;
let lobbyTimer = null; // refreshes the lobby's round-trip times
const STATUS = { open: 'connected', connecting: 'connecting…', waiting: 'joining…', gone: 'left' };

function openLive(code = '') {
  els.liveError.replaceChildren();
  els.liveCode.value = code;
  chooseLive(code ? 'join' : 'make');
  if (account.offline) els.liveError.textContent = 'Live races need paddlesnitch.com: open the game there.';
  else if (!account.user) els.liveError.replaceChildren('Live races need an account. ', link('Sign in', SIGN_IN + encodeURIComponent(code ? `#race=${code}` : '')));
  showLobby();
  openDialog(live);
  if (code && account.user && !lobby) joinRace(code);
}

function joinRace(code) {
  if (!/^[A-Z]{4}$/.test(code)) {
    els.liveError.textContent = 'A race code is four letters.';
    return;
  }
  enterLobby(call('games.live.join', { code }, { mutation: true }));
}

async function enterLobby(request) {
  els.liveError.replaceChildren();
  try {
    const info = await request;
    lobby = joinLive(info, { players: () => { shareKit(); showLobby(); }, message: onLive });
    lobbyTimer = setInterval(showLobby, 1000);
    lobby.course = info.room.course;
    history.replaceState(null, '', `#${HASH.has('debug') ? 'debug&' : ''}race=${info.room.code}`);
    showLobby();
  } catch (err) {
    els.liveError.textContent = err.status === 404 ? 'That race has finished, or it is full.' : "Couldn't get into the race. Please try again.";
  }
}

// Your kit goes to each player as they connect, so they see your paddler and boat.
const kitSentTo = new Set();
function shareKit() {
  for (const p of lobby?.players ?? []) {
    const open = p.id !== lobby.you && lobby.status(p.id) === 'open';
    if (open && !kitSentTo.has(p.id)) lobby.sure({ type: 'kit', kit }, p.id);
    if (open) kitSentTo.add(p.id);
    else kitSentTo.delete(p.id);
  }
}

function showLobby() {
  els.liveSetup.hidden = !!lobby;
  els.liveLobby.hidden = !lobby;
  if (!lobby) return;
  els.liveCodeShow.textContent = lobby.code;
  els.liveCourseShow.textContent = MODES[lobby.course]?.label ?? lobby.course;
  els.livePlayers.replaceChildren(...lobby.players.map((p) => {
    const li = document.createElement('li');
    const you = p.id === lobby.you;
    const look = you ? kit : kits.get(p.id);
    if (look) li.append(make(`<svg class="face" viewBox="0 0 120 120" aria-hidden="true">${paddlerSvg(look)}</svg>`));
    li.append(`${p.name}${you ? ' (you)' : ''}${p.id === lobby.host ? ', starter' : ''} `);
    const small = document.createElement('small');
    const rtt = lobby.status(p.id) === 'open' && lobby.rtt(p.id);
    small.textContent = you ? '' : `${STATUS[lobby.status(p.id)]}${rtt ? ` · ${rtt} ms` : ''}`;
    li.append(small);
    if (you) li.className = 'you';
    return li;
  }));
  const ready = lobby.players.filter((p) => p.id !== lobby.you && lobby.status(p.id) === 'open');
  const host = lobby.host === lobby.you;
  els.liveStart.hidden = !host;
  els.liveStart.disabled = !ready.length;
  els.liveNote.textContent = host
    ? ready.length ? "Start it when everyone's in." : 'Send the link to your friends. You can start once someone has joined.'
    : 'The race starts when its starter starts it.';
}

// Making a race (pick a course) or joining one (just its code: the course is its maker's).
function chooseLive(which) {
  els.liveMakeTab.setAttribute('aria-pressed', which === 'make');
  els.liveJoinTab.setAttribute('aria-pressed', which === 'join');
  els.liveMake.hidden = which !== 'make';
  els.liveJoinBox.hidden = which !== 'join';
}
els.liveMakeTab.addEventListener('click', () => chooseLive('make'));
els.liveJoinTab.addEventListener('click', () => {
  chooseLive('join');
  els.liveCode.focus();
});

const raceLink = () => `${location.origin}${location.pathname}#race=${lobby.code}`;

els.liveCreate.addEventListener('click', () => enterLobby(call('games.live.create', { course: els.liveCourse.value }, { mutation: true })));
els.liveJoin.addEventListener('click', () => joinRace(els.liveCode.value.trim().toUpperCase()));
els.liveCopy.addEventListener('click', () => {
  navigator.clipboard?.writeText(raceLink()).then(() => { els.liveCopy.textContent = 'Copied'; }).catch(() => {});
});
els.liveStart.addEventListener('click', () => {
  const order = lobby.players.filter((p) => p.id === lobby.you || lobby.status(p.id) === 'open').map(({ id, name }) => ({ id, name }));
  const seed = (Math.random() * 2 ** 31) | 0;
  lobby.sure({ type: 'start', order, seed });
  begin(order, seed);
});
live.addEventListener('close', () => {
  if (!liveRace) toMenu(); // Back, or Escape, from the lobby
});

function onLive(id, msg) {
  if (Array.isArray(msg)) {
    const s = decodeState(msg);
    if (!s) return;
    if (!tracks.has(id)) tracks.set(id, createTrack());
    receive(tracks.get(id), s, performance.now() / 1000);
    return;
  }
  const r = race?.racers.find((x) => x.id === id);
  if (msg.type === 'start' && id === lobby?.host && !liveRace && msg.order.some((p) => p.id === lobby.you)) begin(msg.order, msg.seed);
  else if (msg.type === 'call' && liveRace && id === lobby.host) applyCall(race, msg.call);
  else if (msg.type === 'finish' && liveRace && r && r.finish === null) r.finish = msg.time;
  else if (msg.type === 'kit') {
    kits.set(id, cleanKit(msg.kit));
    if (liveRace) setLiveries();
    showLobby();
  } else if (msg.type === 'bye') {
    if (liveRace && r) r.name = `${r.name} (left)`;
    showLobby();
  }
}

async function begin(order, seed) {
  const m = MODES[lobby.course];
  if (!m.course) m.course = await loadCourse(m.file);
  lobby.racing();
  clearInterval(lobbyTimer);
  liveRace = { room: { you: lobby.you, host: lobby.host }, order, seed };
  tracks.clear();
  mode = m;
  live.close();
  if (renderer) useWorld();
  start();
}

// Before each step: the others' boats where the network last said, a little behind.
function liveBefore(dt) {
  const now = performance.now() / 1000;
  for (const r of race.racers) {
    const track = r.remote && tracks.get(r.id);
    const s = track && sample(track, now, r.boat.speedup);
    if (s) applyState(r.boat, s);
  }
  sendTimer += dt;
  if (sendTimer >= 1 / SEND_HZ) {
    sendTimer = 0;
    lobby.fast(encodeState(now, race.player.boat));
  }
}

// After each step: the host passes on the starter's calls; everyone their finish.
function liveAfter(events) {
  for (const e of events) {
    if (lobby.host === lobby.you && ['line-up', 'ready', 'go', 'hold'].includes(e)) lobby.sure({ type: 'call', call: e });
    if (e === 'finish') lobby.sure({ type: 'finish', time: race.player.finish });
  }
}

function endLive() {
  if (!lobby && !liveRace) return;
  lobby?.close();
  clearInterval(lobbyTimer);
  lobby = null;
  liveRace = null;
  tracks.clear();
  kits.clear();
  kitSentTo.clear();
  if (HASH.has('race') || location.hash.includes('race=')) {
    HASH.delete('race');
    history.replaceState(null, '', `${location.pathname}${HASH.has('debug') ? '#debug' : ''}`);
  }
}

// --- feedback ----------------------------------------------------------------

let flashTimer = 0;
function show(text, { small = false, hold = 0.8 } = {}) {
  flash.textContent = text;
  flash.classList.toggle('small', small);
  flash.classList.add('show');
  flashTimer = hold;
}

const sounds = {
  stroke: () => {
    noise({ freq: 700 + Math.random() * 300, to: 300, q: 0.8, duration: 0.25, gain: 0.1 });
    tone({ freq: 85, to: 60, duration: 0.06, type: 'sine', gain: 0.06 });
  },
  weak: () => noise({ freq: 1800, to: 900, q: 1.2, duration: 0.12, gain: 0.05 }),
  // A back stroke: the blade pushed forward through the water, duller.
  back: () => noise({ freq: 450, to: 250, q: 0.8, duration: 0.3, gain: 0.08 }),
  capsize: () => {
    noise({ freq: 1600, to: 180, q: 0.7, duration: 1.3, gain: 0.3, type: 'lowpass' });
    tone({ freq: 220, to: 55, duration: 0.8, type: 'triangle', gain: 0.12 });
  },
  remount: () => noise({ freq: 600, to: 300, q: 0.7, duration: 0.4, gain: 0.08 }),
  bank: () => {
    noise({ freq: 400, to: 120, q: 0.6, duration: 0.3, gain: 0.15, type: 'lowpass' });
    tone({ freq: 70, duration: 0.12, type: 'sine', gain: 0.1 });
  },
  // An angry swan: a hiss and a honk.
  swan: () => {
    noise({ freq: 3200, to: 2400, q: 0.6, duration: 0.6, gain: 0.12 });
    tone({ freq: 520, to: 430, duration: 0.25, type: 'sawtooth', gain: 0.08 });
  },
  // Paddling through a fishing line: the reel's ratchet screaming as it runs out.
  line: () => {
    for (let k = 0; k < 6; k++) setTimeout(() => tone({ freq: 2400 + k * 120, duration: 0.05, type: 'square', gain: 0.05 }), k * 55);
    noise({ freq: 3000, to: 1800, q: 1.5, duration: 0.35, gain: 0.06 });
  },
  // The starter: a horn for the off, a whistle for a jumped start.
  go: () => {
    tone({ freq: 233, duration: 0.9, type: 'sawtooth', gain: 0.12 });
    tone({ freq: 349, duration: 0.9, type: 'sawtooth', gain: 0.08 });
  },
  hold: () => {
    tone({ freq: 2600, to: 2400, duration: 0.25, type: 'sine', gain: 0.12 });
    setTimeout(() => tone({ freq: 2600, to: 2300, duration: 0.45, type: 'sine', gain: 0.12 }), 300);
  },
  bump: () => {
    tone({ freq: 180, to: 110, duration: 0.09, type: 'triangle', gain: 0.14 });
    noise({ freq: 900, to: 400, q: 1, duration: 0.15, gain: 0.08 });
  },
};
// Running into another boat: a crack of oars, or a thump on a hull.
for (const kind of Object.keys(TRAFFIC)) {
  sounds[`hit-${kind}`] = () => {
    tone({ freq: TRAFFIC[kind].oars ? 900 : 140, to: TRAFFIC[kind].oars ? 500 : 80, duration: 0.12, type: 'square', gain: 0.12 });
    noise({ freq: 1200, to: 500, q: 0.9, duration: 0.2, gain: 0.12 });
  };
}
const HIT = { sculler: "You hit a sculler's oars!", eight: 'You hit an eight!', cruiser: 'You hit a cruiser!', motorboat: 'You hit a motorboat!' };

// The starter's voice, through the browser's own speech synthesis. Asking for
// the voices early saves a stall on the first call.
window.speechSynthesis?.getVoices();
function say(text) {
  if (isMuted() || !window.speechSynthesis) return;
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  u.pitch = 0.9;
  speechSynthesis.speak(u);
}

function react({ events, splashes }) {
  for (const e of events) {
    sounds[e]?.();
    if (e === 'stroke' || e === 'back') controls.rumble(0.25, 40);
    if (e === 'weak') show('Weak stroke', { small: true, hold: 0.5 });
    if (e === 'crab') {
      show('You caught a crab! Keep the boat level', { small: true, hold: 2 });
      noise({ freq: 900, to: 150, q: 0.7, duration: 0.5, gain: 0.18, type: 'lowpass' });
      tone({ freq: 140, to: 70, duration: 0.25, type: 'triangle', gain: 0.1 });
      controls.rumble(0.9, 300);
    }
    if (e === 'swan') hitSwan = race.time;
    if (e.startsWith('hit-')) hitBoat = { kind: e.slice(4), time: race.time };
    if (e === 'capsize') {
      const why = race.time - hitSwan < 0.5 ? 'You hit a swan!' : race.time - hitBoat.time < 0.5 ? HIT[hitBoat.kind] : 'Capsized!';
      show(why, { hold: race.player.boat.hull.swimTime - 0.5 });
      controls.rumble(1, 400);
    }
    if (e === 'line') {
      say('Oi! Mind my line!');
      show('You paddled into a fishing line!', { small: true, hold: 2 });
      controls.rumble(0.7, 300);
    }
    if (e === 'bank') controls.rumble(0.8, 150);
    if (e === 'bump') controls.rumble(0.6, 120);
    if (e === 'finish') finish();
    // The portage: slow in to the beach, jump out, run it, jump back in.
    const both = phone.matches ? 'tap with both thumbs at once' : 'press \u2190 and \u2192 together';
    if (e === 'beach' && !drill) show(`The beach: slow right down, then ${both} to jump out`, { small: true, hold: 3.5 });
    if (e === 'too-fast') show('Too fast to get out: slow down', { small: true, hold: 1.5 });
    if (e === 'aground') {
      show('Aground! Too fast into the beach', { small: true, hold: 2.5 });
      controls.rumble(1, 400);
    }
    if (e === 'landed') {
      show('Out! Tap left, right to run with the boat', { small: true, hold: 2.5 });
      controls.rumble(0.5, 200);
    }
    if (e === 'at-put-in' && !drill) show(`The put-in: ${both} to get in`, { small: true, hold: 3 });
    if (e === 'put-in') show('In. Keep it level a moment, then paddle', { small: true, hold: 2.5 });
    if (e === 'rushed') show('Steady! Let it settle first', { small: true, hold: 1.2 });
    if (e === 'line-up') say(race.start.holds ? 'Back to the line' : 'Paddlers, come up to the line');
    if (e === 'nudge') say("Come on up to the line, please. We're waiting for you");
    if (e === 'ready') say('Are you ready?');
    if (e === 'ten') {
      say('Ten seconds');
      show('Your start in 10', { small: true, hold: 1.5 });
    }
    if (e === 'count') {
      const n = Math.ceil(race.player.release - race.time);
      say(String(n));
      show(String(n), { hold: 0.7 });
    }
    if (e === 'hold') say('Hold it! Hold the line!');
    // The cox of an eight coming up behind you: they're on that side, so move the other way.
    if (e.startsWith('behind-')) {
      const side = e.slice(7);
      say(`Kayak! Eight coming through on your ${side}!`);
      show(`An eight is coming up behind you, on your ${side}: move ${side === 'left' ? 'right' : 'left'}`, { small: true, hold: 4 });
      els.behind.className = `on ${side}`;
      clearTimeout(behindTimer);
      behindTimer = setTimeout(() => { els.behind.className = ''; }, 6000);
      controls.rumble(0.5, 250);
    }
    if (e === 'line-up') show(race.start.holds ? 'Come back up to the line' : race.racers.length > 1 ? 'Paddle up into a gap on the line' : 'Wait for the horn', { small: true, hold: 3 });
    if (e === 'nudge') show('Paddle up to the line and stop', { small: true, hold: 3 });
    if (e === 'ready') show('Are you ready?', { small: true, hold: 1 });
    if (e === 'go') {
      state = 'racing';
      show('Go!', { hold: 0.6 });
      // Out and back on the same water: the courses round islands and back to the club.
      if (race.course.samples.some((p) => p.shared)) setTimeout(() => show('Keep right: boats come back the other way', { small: true, hold: 3 }), 1500);
      controls.rumble(0.8, 300);
    }
    if (e === 'hold') {
      show('Hold the line! You jumped the start', { small: true, hold: 3 });
      controls.rumble(0.5, 200);
    }
  }
  // The pack around you: nearby blades are louder.
  for (const d of splashes) {
    if (d < 25) noise({ freq: 600 + Math.random() * 400, to: 280, q: 0.8, duration: 0.2, gain: 0.07 * Math.min(1, 3 / d) ** 1.5 });
  }
}

// --- simulation --------------------------------------------------------------

function simulate(dt) {
  const input = controls.take();
  const boat = race.player.boat;
  if (state === 'finished') {
    // Over the line you glide to a stop; nobody should capsize after finishing.
    input.strokes = [];
    input.lean = Math.max(-1, Math.min(1, -(boat.roll * 2 + boat.rollRate * 0.6)));
  } else if (state !== 'racing' && state !== 'start') {
    return;
  }
  if (race.outing) return outingStep(dt);
  // A scull has no rudder: Q and E look over your shoulders (the phone's twist and a slid finger still nudge it).
  if (boat.hull.scull) input.rudder = input.rudderNoKeys;
  if (controls.assist) input.lean = Math.max(-1, Math.min(1, input.lean - (boat.roll * 2 + boat.rollRate * 0.6)));
  else if (controls.tilting) input.lean = Math.max(-1, Math.min(1, input.lean - TILT_REFLEX * boat.rollRate));
  if (liveRace) liveBefore(dt);
  const result = stepRace(race, dt, input);
  if (liveRace) liveAfter(result.events);
  react(result);
  if (drill && state === 'racing') {
    trackDrill(drill, race, result.events, dt);
    if (drill.done) finishDrill();
  }
}

// --- rendering ---------------------------------------------------------------

const frameData = new Float32Array(120);
// Deep water: a made-up river's, and the real Thames's olive green.
const WATER = [0.07, 0.2, 0.24, 0];
const THAMES = [0.19, 0.23, 0.16, 0];
const SUN = normalize([0.35, 0.42, -0.84]);

function boatFrame(b, y = 0) {
  const h = b.heading;
  const f = [Math.sin(h), 0, -Math.cos(h)];
  const r = [Math.cos(h), 0, Math.sin(h)];
  // During a capsize the boat rolls right over, then rights itself.
  let roll = b.roll;
  if (b.swim > 0) {
    const t = b.hull.swimTime - b.swim;
    const over = Math.min(1, t / 0.5) * Math.min(1, b.swim / 0.6);
    roll = Math.sign(b.roll || 1) * (BOAT.capsize + (1.9 - BOAT.capsize) * over);
  }
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const up = [s * r[0], c, s * r[2]];
  const right = [c * r[0], -s, c * r[2]];
  return { f, up, right, back: f.map((v) => -v), pos: [b.x, y, b.z] };
}

// Where the player's paddle is in boat space, seen from the cockpit. It rests
// low across the deck, just out of view. A stroke reaches forward and spears
// the working blade in by the bow, then the blade holds in the water while
// the boat drives past it, back to the hip, where it lifts out to the side.
// A back stroke goes the other way: in by the hip, pushed forward to the bow.
// Also returns `reach`: how far the paddler's body leans into the catch.
function paddlePose(b) {
  const t = b.time - b.paddle.at;
  const dir = b.paddle.side === 'left' ? 1 : -1; // working blade at -x for a left stroke
  const REST = { y: 0.16, z: -0.6, yaw: 0, tilt: 0 };
  // depth 0..1: how far the blade is buried.
  const pose = (p) => {
    const depth = p < 0.12 ? smooth(p / 0.12) : 1 - smooth((p - 0.8) / 0.2);
    const drive = b.paddle.back ? 1 - smooth((p - 0.08) / 0.75) : smooth((p - 0.08) / 0.75);
    return {
      depth,
      tilt: dir * (0.3 + 0.5 * depth), // shaft steep, top hand high
      y: 0.2 + 0.26 * depth,
      z: -0.8 + 0.9 * drive, // hands come back past you as the boat runs on
      yaw: dir * (-0.45 + 0.6 * drive), // the working blade starts forward
    };
  };
  let p = REST;
  let reach = 0;
  if (b.paddle.side && t < BOAT.strokeTime) {
    p = pose(t / BOAT.strokeTime);
    reach = 1 - smooth(t / (BOAT.strokeTime * 0.6));
  } else if (b.paddle.side && t < BOAT.strokeTime + 0.3) {
    // Recovery: swing back to rest across the deck, ready for the other side.
    const from = pose(1);
    const k = smooth((t - BOAT.strokeTime) / 0.3);
    p = Object.fromEntries(Object.keys(REST).map((key) => [key, from[key] + (REST[key] - from[key]) * k]));
    reach = 0;
  }
  return {
    matrix: multiply(translation(0, p.y, p.z), multiply(rotationZ(p.tilt), rotationY(p.yaw))),
    reach,
  };
}

// A rival's paddle through a real stroke, in boat space. The blade is planted
// by the feet, stays put in the water while the boat runs past it (so in the
// boat's frame it slides back along the hull, a little outward, like a wing
// blade), exits by the hip and the paddle rolls over for the other side. The
// top hand stays high and the torso unwinds through each stroke.
const PADDLE_HALF = 0.85; // shaft centre to blade centre
function rivalPaddle(b) {
  const beat = Math.min(1.1, Math.max(0.45, b.beat ?? 0.65));
  const t = b.time - b.paddle.at;
  if (!b.paddle.side || b.swim > 0 || t > beat * 1.6) {
    return { matrix: frameFrom([0, 0.5, -0.3], [1, 0, 0]), twist: 0 };
  }
  const side = b.paddle.side === 'left' ? -1 : 1;
  const IN_WATER = 0.62;
  const p = Math.min(1, t / beat);
  // Pose with the `e`-side blade a fraction q through its pull.
  const pull = (e, q, dt) => {
    const dip = Math.sin(Math.PI * q);
    const blade = [e * (0.55 + 0.15 * q), -0.08 - 0.14 * dip, Math.min(0.3, -1.0 + Math.max(b.speed * dt, q * 0.9))];
    const centre = [e * 0.1, 0.42 + 0.05 * dip, blade[2] * 0.45 - 0.2];
    return { axis: normalize(blade.map((v, i) => (v - centre[i]) * e)), blade, e, twist: -e * 0.3 * (1 - 2 * q) };
  };
  let pose;
  if (p < IN_WATER) {
    pose = pull(side, p / IN_WATER, t);
  } else {
    // Out of the water: swing over to the catch on the other side.
    const from = pull(side, 1, beat * IN_WATER);
    const to = pull(-side, 0, 0);
    const k = smooth((p - IN_WATER) / (1 - IN_WATER));
    const axis = normalize(from.axis.map((v, i) => v + (to.axis[i] - v) * k));
    const centreFrom = from.blade.map((v, i) => v - from.axis[i] * from.e * PADDLE_HALF);
    const centreTo = to.blade.map((v, i) => v - to.axis[i] * to.e * PADDLE_HALF);
    const centre = centreFrom.map((v, i) => v + (centreTo[i] - v) * k);
    centre[1] += 0.12 * Math.sin(Math.PI * k); // lift the paddle clear as it rolls over
    return { matrix: frameFrom(centre, axis), twist: from.twist + (to.twist - from.twist) * k };
  }
  const centre = pose.blade.map((v, i) => v - pose.axis[i] * pose.e * PADDLE_HALF);
  return { matrix: frameFrom(centre, pose.axis), twist: pose.twist };
}

// Paddle matrix: shaft along `axis` (local x), centred on `centre`, blade faces
// turned towards the stern.
function frameFrom(centre, axis) {
  const back = [0, 0, 1];
  const d = back[0] * axis[0] + back[1] * axis[1] + back[2] * axis[2];
  const z = normalize(back.map((v, i) => v - d * axis[i]));
  const y = [z[1] * axis[2] - z[2] * axis[1], z[2] * axis[0] - z[0] * axis[2], z[0] * axis[1] - z[1] * axis[0]];
  return basis(axis, y, z, centre);
}

function smooth(x) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

// An arm from shoulder to hand (both in boat space), as a stretched limbMesh.
function limb(model, from, to) {
  const d = to.map((v, i) => v - from[i]);
  const n = normalize(d);
  const a = normalize(Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [-n[2], 0, n[0]]);
  const b = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  return multiply(model, basis(a.map((v) => v * 0.075), b.map((v) => v * 0.075), d, from));
}

// The other boats on the river (traffic.js), rowers' oars swinging: the blade
// in the water through the drive, back up and over on the recovery.
const STROKE = { sculler: 0.38, eight: 0.5 }; // strokes a second
function oarFrom(model, from, to) {
  const d = to.map((v, i) => v - from[i]);
  const n = normalize(d);
  const a = normalize([-n[2], 0, n[0]]);
  const b = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  return multiply(model, basis(a, b, d, from));
}
function placeTraffic() {
  const where = Object.fromEntries(Object.keys(TRAFFIC).map((k) => [k, []]));
  const oars = [...(race.player.boat.hull.scull ? myRowing.oars : [])];
  const paddles = [];
  const swimmers = [];
  // A head race's rival scullers, on the river's scull with its rower.
  for (const r of rowingRivals) {
    const fr = boatFrame(r.boat);
    const model = basis(fr.right, fr.up, fr.back, fr.pos);
    if (r.boat.swim > 0) {
      swimmers.push(basis(fr.f, [0, 1, 0], fr.right, [r.boat.x + fr.right[0] * 1.1, 0, r.boat.z + fr.right[2] * 1.1]));
      where.sculler.push(multiply(model, rotationZ(Math.PI)));
      continue;
    }
    where.sculler.push(model);
    const rate = 18 + r.boat.speed * 3.5; // strokes a minute
    const p = (r.boat.time * rate / 60 + (r.phase ??= Math.random())) % 1;
    const drive = p < 0.4;
    const angle = drive ? 0.6 - 1.1 * smooth(p / 0.4) : -0.5 + 1.1 * smooth((p - 0.4) / 0.6);
    const len = TRAFFIC.sculler.oars[2] - ROWLOCKS.sculler[0][1];
    for (const [side, x, z] of ROWLOCKS.sculler) oars.push(oarFrom(model, [side * x, 0.2, z], [side * (x + len * Math.cos(angle)), drive ? -0.05 : 0.3, z - len * Math.sin(angle)]));
  }
  for (const b of race.traffic?.boats ?? []) {
    if (!b.on) continue;
    const f = [Math.sin(b.heading), 0, -Math.cos(b.heading)];
    const bob = 0.03 * Math.sin(race.time * 1.3 + b.phase);
    // Knocked in by the launch: rolled over, the crew swimming alongside.
    const { over, swimming } = overturned(b, race.time);
    if (over > 0) {
      const a = over * Math.PI;
      const right = [-f[2], 0, f[0]];
      const r = right.map((v) => v * Math.cos(a)).map((v, i) => v + [0, Math.sin(a), 0][i]);
      const u = right.map((v) => -v * Math.sin(a)).map((v, i) => v + [0, Math.cos(a), 0][i]);
      where[b.kind].push(basis(r, u, f.map((v) => -v), [b.x, bob - 0.12 * over, b.z]));
      if (swimming) {
        const side = 0.75 + TRAFFIC[b.kind].hull;
        swimmers.push(basis(f, [0, 1, 0], right, [b.x + right[0] * side, bob, b.z + right[2] * side]));
      }
      continue;
    }
    const model = basis([-f[2], 0, f[0]], [0, 1, 0], f.map((v) => -v), [b.x, bob, b.z]);
    where[b.kind].push(model);
    // A kayaker's paddle swings from side to side, about a stroke a second each side.
    if (b.kind === 'kayaker') {
      const w = 0.55 * Math.sin(race.time * Math.PI * 1.7 + b.phase);
      paddles.push(multiply(model, frameFrom([0, 0.5, SEAT - 0.5], normalize([Math.cos(w), -0.45 * Math.sin(w), 0.35 * Math.sin(w)]))));
    }
    if (!ROWLOCKS[b.kind]) continue;
    const p = (race.time * STROKE[b.kind] + b.phase) % 1;
    const drive = p < 0.4;
    const angle = drive ? 0.6 - 1.1 * smooth(p / 0.4) : -0.5 + 1.1 * smooth((p - 0.4) / 0.6);
    const len = TRAFFIC[b.kind].oars[2] - ROWLOCKS[b.kind][0][1];
    for (const [side, x, z] of ROWLOCKS[b.kind]) {
      const from = [side * x, 0.2, z];
      oars.push(oarFrom(model, from, [side * (x + len * Math.cos(angle)), drive ? -0.05 : 0.3, z - len * Math.sin(angle)]));
    }
  }
  for (const [kind, list] of Object.entries(where)) renderer.place(meshes.traffic[kind], list);
  renderer.place(meshes.oar, oars);
  renderer.place(meshes.trafficPaddle, paddles);
  renderer.place(meshes.swimmer, swimmers);
}

// A motorboat's engine: a low rumble, louder as it comes by.
function engines(dt) {
  engineTimer -= dt;
  if (engineTimer > 0 || !race.traffic) return;
  engineTimer = 0.22;
  const me = race.player.boat;
  for (const b of race.traffic.boats) {
    if (!b.on || b.kind !== 'motorboat') continue;
    const d = Math.hypot(b.x - me.x, b.z - me.z);
    if (d < 90) noise({ freq: 110, to: 95, q: 1.5, duration: 0.3, gain: 0.07 * (1 - d / 90), type: 'lowpass' });
  }
}

// On a portage you run along the bank with the boat on your shoulder: where
// you stand (the seat's height, so the eye's at a standing height) and the boat.
function carried(r) {
  if (r.portage?.phase !== 'run' && r.portage?.phase !== 'put') return null;
  const bob = 0.05 * Math.abs(Math.sin(r.boat.time * 9));
  const g = groundAt(race.course, r.boat.x, r.boat.z) + bob;
  return { seat: g + 0.75, boat: g + 1.8 };
}

// The rivals in a head race are scullers: drawn as the river's sculls (traffic),
// their oars swung at a rate from their speed. Handed to placeTraffic.
let rowingRivals = [];
// Your scull, from the seat: the hull in your colour, both oars from scullPose
// (handles in your hands, blades out over the water), your legs and arms.
function placeMyScull(model, boat) {
  meshes.myScull ??= new Map();
  if (!meshes.myScull.has(kit.scullColour)) meshes.myScull.set(kit.scullColour, renderer.createMesh(scullHullMesh({ deck: rgbOf(kit.scullColour), hull: rgbOf(kit.scullColour).map((v) => v * 0.94) })));
  const hull = meshes.myScull.get(kit.scullColour);
  renderer.place(hull, [model]);
  myRowing.list = [hull];
  const pose = scullPose(boat);
  const { x: rx, y: ry, z: rz } = SCULL_ROWLOCK;
  const hands = [];
  const oars = [];
  for (const side of [-1, 1]) {
    const o = side < 0 ? pose.left : pose.right;
    const a = o.sweep * 0.85; // radians from square: the blade to the stern at the finish
    const dir = [side * Math.cos(a), 0, Math.sin(a)];
    const pin = [side * rx, ry, rz];
    // Handles a little higher on the recovery (blades up), lower through the drive (blades buried).
    const handle = [pin[0] - dir[0] * 0.88, ry + 0.06 - 0.1 * o.depth + (o.feather ? -0.04 : 0), pin[2] - dir[2] * 0.88];
    const tip = [pin[0] + dir[0] * 2.0, ry - 0.42 * o.depth + (o.depth ? 0 : 0.22), pin[2] + dir[2] * 2.0];
    oars.push(oarFrom(model, handle, tip));
    hands.push(handle);
  }
  myRowing.oars = oars;
  // You: hips on the seat (up the slide towards the stern at the catch), feet
  // in the shoes, hands on the handles, leaning into the catch.
  const seat = SCULL_SEAT.finish + (SCULL_SEAT.catch - SCULL_SEAT.finish) * pose.slide;
  const lean = 0.4 * pose.slide - 0.25 * (1 - pose.slide);
  const l = suitOf({ key: kitKey(kit), ...livery(kit) });
  // (Not your body: the camera's in your head. Your legs and arms.)
  myRowing.list.push(...rowerParts(model, l, { hips: [0, SCULL_SEAT.y + 0.1, seat], feet: [0, SCULL_FEET.y, SCULL_FEET.z], hands, lean, facing: 1 }).slice(1));
  myRowing.pose = pose;
  myRowing.seat = seat;
  myRowing.lean = lean;
}
const myRowing = { list: [], oars: [], pose: null, seat: 0, lean: 0 };

function placeRacers() {
  rowingRivals = [];
  const paddles = new Map([...meshes.paddles.values()].map((m) => [m, []])); // mesh -> where
  const hold = (r, matrix) => {
    const mesh = paddleFor(r);
    if (!paddles.has(mesh)) paddles.set(mesh, []);
    paddles.get(mesh).push(matrix);
  };
  for (const r of race.racers) {
    const lift = carried(r);
    const fr = boatFrame(r.boat, lift?.seat);
    const model = basis(fr.right, fr.up, fr.back, fr.pos);
    // Carried, the boat's on your right shoulder; no paddling.
    const hullAt = lift ? [fr.pos[0] + fr.right[0] * 0.55, lift.boat, fr.pos[2] + fr.right[2] * 0.55] : fr.pos;
    // On an outing you're on the trip boat or the launch, not in a kayak.
    if (r === race.player && race.outing) {
      renderer.place(meshes.outing[race.outing.kind], [basis(fr.right, fr.up, fr.back, fr.pos)]);
      continue;
    }
    // Rowing: your scull from the seat, the rivals' sculls with their rowers.
    if (r.boat.hull.scull) {
      if (r === race.player) placeMyScull(model, r.boat);
      continue;
    }
    if (mode.row && r !== race.player) {
      rowingRivals.push(r);
      continue;
    }
    renderer.place(kayakFor(r), [basis(fr.right, fr.up, fr.back, hullAt)]);
    if (r === race.player) {
      if (!lift) hold(r, multiply(model, paddlePose(r.boat).matrix));
      continue;
    }
    const set = paddlerFor(r);
    if (lift) {
      renderer.place(set.body, [multiply(model, translation(0, 0, SEAT))]);
      renderer.place(set.arms, []);
      continue;
    }
    // The paddler twists with the stroke; hands stay on the shaft.
    const pose = rivalPaddle(r.boat);
    hold(r, multiply(model, pose.matrix));
    renderer.place(set.body, [multiply(model, multiply(translation(0, 0, SEAT), rotationY(pose.twist)))]);
    const sh = shoulderOf(liveries.get(r)?.body);
    const arms = [-1, 1].map((side) => {
      const c = Math.cos(pose.twist);
      const s = Math.sin(pose.twist);
      const shoulder = [side * sh.x * c, sh.y, SEAT - side * sh.x * s];
      return limb(model, shoulder, apply(pose.matrix, [side * 0.36, 0, 0]));
    });
    renderer.place(set.arms, arms);
  }
  for (const [mesh, where] of paddles) renderer.place(mesh, where);
  // Swans and ducks, bobbing; a duck in the air flaps up and away.
  const birds = { swan: [], duck: [] };
  for (const b of race.birds) {
    if (b.gone || birds[b.kind].length >= BIRDS_DRAWN) continue;
    const f = [Math.sin(b.heading), 0, -Math.cos(b.heading)];
    const y = b.fly > 0 ? Math.min(6, b.fly * 2) : 0.02 * Math.sin(b.phase * 2);
    birds[b.kind].push(basis([-f[2], 0, f[0]], [0, 1, 0], f.map((v) => -v), [b.x, y, b.z]));
  }
  renderer.place(meshes.swan, birds.swan);
  renderer.place(meshes.duck, birds.duck);
}

let reflected = null; // the river line the water's reflections are taken from, eased
let viewProj = null; // the last frame's camera, for placing the club's door labels
function render(time) {
  placeRacers();
  placeTraffic();
  const boat = race.player.boat;
  const fr = boatFrame(boat, carried(race.player)?.seat);

  // Eye just behind the cockpit, pitched down a touch to see the bow. You
  // lean into each catch, and the boat surges on under you as you drive.
  const bob = 0.012 * Math.sin(boat.time * 7) * Math.min(1, boat.speed / 3);
  const lift = boat.swim > 0 ? -0.45 : 0;
  const lean = 0.06 * paddlePose(boat).reach;
  let eye = fr.pos.map((p, i) => p + fr.up[i] * (EYE_HEIGHT + bob + lift - lean * 0.3) + fr.back[i] * (0.15 - lean));
  const pitch = 0.11;
  let fwd = normalize(fr.f.map((v, i) => v * Math.cos(pitch) - fr.up[i] * Math.sin(pitch)));
  let up = normalize(fr.up.map((v, i) => v * Math.cos(pitch) + fr.f[i] * Math.sin(pitch)));
  let right = fr.right;
  // In a scull: sat facing the stern, eye going up and down the slide with
  // you, looking down a little at the stretcher and the coach; Q or E (X or B,
  // or a Look button) turns your head round over that shoulder to see where you're going.
  if (boat.hull.scull && state !== 'menu' && myRowing.pose) {
    const local = [0, SCULL_SEAT.y + 0.95 - 0.12 * Math.max(0, myRowing.lean), myRowing.seat + 0.1 + 0.32 * Math.max(0, myRowing.lean)];
    eye = fr.pos.map((p, i) => p + fr.right[i] * local[0] + fr.up[i] * (local[1] + bob + lift) + fr.back[i] * local[2]);
    const turn = lookBack * 2.6; // radians: over the right shoulder (+) or the left (-)
    const pitch = 0.42 * (1 - Math.abs(lookBack)) + 0.05;
    const ahead = fr.back.map((v, i) => v * Math.cos(turn) + fr.right[i] * -Math.sin(turn));
    fwd = normalize(ahead.map((v, i) => v * Math.cos(pitch) - fr.up[i] * Math.sin(pitch)));
    right = normalize([-fwd[2], 0, fwd[0]]);
    up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  }
  // On an outing: standing at the trip boat's bow, or at the launch's helm, looking about.
  if (race.outing && state !== 'menu') {
    const o = OUTINGS[race.outing.kind];
    eye = fr.pos.map((p, i) => p + fr.f[i] * o.forward + [0, 1, 0][i] * o.eye);
    const yaw = boat.heading + race.outing.look;
    const p = 0.07;
    fwd = [Math.sin(yaw) * Math.cos(p), -Math.sin(p), -Math.cos(yaw) * Math.cos(p)];
    right = normalize([-fwd[2], 0, fwd[0]]);
    up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  }
  // On the walk to the club, the place's camera instead.
  const shot = club && state === 'menu' ? clubCamera() : null;
  if (shot) {
    eye = shot.eye;
    fwd = normalize(shot.look.map((v, i) => v - eye[i]));
    right = normalize([-fwd[2], 0, fwd[0]]);
    up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  }
  // Portrait screens widen the vertical view so the horizontal one stays usable.
  const aspect = renderer.aspect;
  // A scull's view is wide: the oars reach out either side of you.
  const wide = shot?.wide ?? (boat.hull.scull && state !== 'menu' ? ROW_WIDE : 0);
  const minX = wide ? (wide * Math.PI) / 180 : MIN_FOV_X;
  let tanY = Math.max(Math.tan(FOV_Y / 2), Math.tan(minX / 2) / aspect);
  // A wide shot on a phone held upright would be mostly the deck under you: cap its height.
  if (shot?.wide) tanY = Math.min(tanY, Math.tan((105 * Math.PI) / 360));
  const proj = perspective(2 * Math.atan(tanY), aspect, 0.05, 2500);

  viewProj = multiply(proj, view(eye, right, up, fwd));
  frameData.set(viewProj, 0);
  frameData.set([...eye, time], 16);
  frameData.set([...right, tanY * aspect], 20);
  frameData.set([...up, tanY], 24);
  frameData.set([...fwd, 0], 28);
  frameData.set([...SUN, 0], 32);
  frameData.set([0.3, 0.52, 0.84, race.course.scenery ? 0.8 : 0], 36); // w: cloud cover, on a real river's English sky
  frameData.set([0.78, 0.85, 0.9, 0.0016], 40);
  frameData.set(race.course.scenery ? THAMES : WATER, 44);
  // Wakes, for the racers and then the nearest other boats (placed so their bow
  // is where a kayak's would be, which is what the water shader expects).
  const wakes = race.racers.filter((r) => !r.portage).map((r) => r.boat).filter((b) => b.swim <= 0).map((b) => [b.x, b.z, b.heading, b.speed]);
  const near = (race.traffic?.boats ?? []).filter((b) => b.on)
    .sort((a, c) => Math.hypot(a.x - boat.x, a.z - boat.z) - Math.hypot(c.x - boat.x, c.z - boat.z));
  for (const b of near) {
    const T = TRAFFIC[b.kind];
    const ahead = T.length / 2 - 3.3;
    wakes.push([b.x + Math.sin(b.heading) * ahead, b.z - Math.cos(b.heading) * ahead, b.heading, T.speed * (T.wash > 0.5 ? 2 : 1.2)]);
  }
  for (let i = 0; i < 16; i++) frameData.set(wakes[i] ?? [0, 0, 0, 0], 48 + i * 4);
  // The riverside trees, for their reflections: a real river's are tall and
  // come down to the water, a made-up one's stand back across the fields.
  reflected = riverView(race.course, race.player.loc.s, reflected, time - (reflected?.time ?? time));
  reflected.time = time;
  const { half } = reflected;
  frameData.set([reflected.x, reflected.z, reflected.tx, reflected.tz], 112);
  frameData.set(race.course.scenery ? [half + 1, half + 1, 6, 1] : [half + 9, half + 4, 7, 1], 116);
  const list = [meshes.worlds.get(worldOf(mode)), meshes.marks.get(mode)];
  for (const r of race.racers) {
    if (r.boat.hull.scull) list.push(...myRowing.list);
    else if (mode.row) continue; // a head race's rivals: drawn as the river's sculls
    else list.push(r === race.player && race.outing ? meshes.outing[race.outing.kind] : kayakFor(r));
    if (r !== race.player && !mode.row) list.push(paddlerFor(r).body, paddlerFor(r).arms);
  }
  list.push(...meshes.paddles.values(), meshes.swan, meshes.duck, ...Object.values(meshes.traffic), meshes.oar, meshes.trafficPaddle, meshes.swimmer);
  if (shot) list.push(...placeClub());
  renderer.draw(frameData, list);
  if (shot) clubEl.classList.remove('waiting');
  if (shot) placeDoors();
  placeCoach();
}

// The stroke coach on your foot stretcher: its numbers, on its screen.
const coachEl = document.getElementById('coach');
function placeCoach() {
  const boat = race.player.boat;
  const on = !!boat.hull.scull && state !== 'menu' && !hud.hidden && Math.abs(lookBack) < 0.1;
  coachEl.hidden = !on;
  if (!on || !viewProj) return;
  const fr = boatFrame(boat);
  const model = basis(fr.right, fr.up, fr.back, fr.pos);
  const [x, y, z] = apply(model, SCULL_COACH);
  const m = viewProj;
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw;
  const cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
  coachEl.style.transform = `translate(${((cx + 1) / 2) * canvas.clientWidth}px, ${((1 - cy) / 2) * canvas.clientHeight}px) translate(-50%, -50%)`;
  const { course } = race;
  const sp = split(boat, course.warp / course.speedup);
  const metres = Math.max(0, race.player.loc.s - course.start) * course.warp / course.speedup;
  const time = race.format === 'interval' ? (race.player.crossed === null ? 0 : elapsed(race, race.player)) : race.time;
  coachEl.innerHTML = `<span class="rate"><b>${scullRate(boat) || '--'}</b><small>SPM</small></span><span class="split"><b>${sp ? formatTime(sp, 0) : '-:--'}</b><small>/500</small></span><span><b>${formatTime(shown(race.player.finish ?? time), 0)}</b><small>TIME</small></span><span><b>${Math.round(metres)}</b><small>M</small></span>`;
}

// Looking round over either shoulder in a scull: Q or E (↑ for the right), X or B (Y for the right), or the two Look buttons.
let lookBack = 0; // -1 over your left shoulder, 1 over your right
let lookWant = 0;
// In a scull: ↑ or E over your right shoulder, Q over your left (a scull has
// no rudder, so Q and E aren't steering here); X and B on a pad; the two Look buttons on a phone.
const lookKeys = []; // look keys held, oldest first: the last one still held wins
const rowingNow = () => race?.player.boat.hull.scull && (state === 'racing' || state === 'start');
addEventListener('keydown', (e) => {
  if (!(e.code in LOOK_KEYS) || !rowingNow()) return;
  e.preventDefault();
  if (!lookKeys.includes(e.code)) lookKeys.push(e.code);
  lookWant = lookFromKeys(lookKeys);
});
addEventListener('keyup', (e) => {
  const i = lookKeys.indexOf(e.code);
  if (i < 0) return;
  lookKeys.splice(i, 1);
  lookWant = lookFromKeys(lookKeys);
});
// Let go of the keys while away (another tab, another window): don't come back looking backwards.
const stopLooking = () => { lookKeys.length = 0; lookWant = 0; };
addEventListener('blur', stopLooking);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopLooking(); });
// The phone's Look buttons: held, they look while held; tapped, a glance that
// comes back on its own, so the other thumb can keep rowing.
const GLANCE = 1.2; // seconds
let glanceUntil = 0;
for (const [id, code] of [['lookLeft', 'LookLeft'], ['lookRight', 'LookRight']]) {
  const btn = document.getElementById(id);
  let down = 0;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    down = clock();
    glanceUntil = 0;
    if (!lookKeys.includes(code)) lookKeys.push(code);
    lookWant = lookFromKeys(lookKeys);
  });
  const up = (e) => {
    e.stopPropagation();
    if (!down || !lookKeys.includes(code)) return;
    if (clock() - down < 0.3) glanceUntil = clock() + GLANCE; // a tap: let it go later
    else lookKeys.splice(lookKeys.indexOf(code), 1);
    lookWant = lookFromKeys(lookKeys);
    down = 0;
  };
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(type, up);
}
function stepLook(dt) {
  // A glance from a tapped Look button is over.
  if (glanceUntil && clock() > glanceUntil) {
    glanceUntil = 0;
    for (const code of ['LookLeft', 'LookRight']) if (lookKeys.includes(code)) lookKeys.splice(lookKeys.indexOf(code), 1);
    lookWant = lookFromKeys(lookKeys);
  }
  const pad = navigator.getGamepads?.()?.find?.((p) => p);
  // On a standard pad: X (the left face button) over the left shoulder, B (the right) or Y over the right.
  const b = pad?.buttons ?? [];
  const want = lookWant || (b[2]?.pressed ? -1 : b[1]?.pressed || b[3]?.pressed ? 1 : 0);
  lookBack = easeLook(lookBack, want, dt);
}


// Open the page with #tilt to see what the motion sensors are doing.
const tiltReadout = HASH.has('tilt') ? document.getElementById('tiltdebug') : null;
const sensorPermissions = {};
if (tiltReadout) {
  tiltReadout.hidden = false;
  for (const name of ['accelerometer', 'gyroscope', 'magnetometer']) {
    navigator.permissions?.query({ name }).then((p) => {
      sensorPermissions[name] = p.state;
      p.onchange = () => { sensorPermissions[name] = p.state; };
    }).catch(() => { sensorPermissions[name] = 'unknown'; });
  }
}
let readoutTimer = 0;
function showTilt(dt) {
  readoutTimer -= dt;
  if (!tiltReadout || readoutTimer > 0) return;
  readoutTimer = 0.2;
  const d = controls.debug;
  const deg = (r) => (r == null ? '-' : `${((r * 180) / Math.PI).toFixed(1)}°`);
  const num = (v) => (v == null ? '-' : v.toFixed(1));
  const boat = race.player.boat;
  tiltReadout.textContent = [
    `secure page: ${isSecureContext}  permission: ${d.permission}`,
    `sensors: ${Object.entries(sensorPermissions).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`,
    `screen: ${screen.orientation?.type ?? '-'} ${screen.orientation?.angle ?? window.orientation ?? '-'}°`,
    `events: orientation ${d.orientations}, motion ${d.motions}  using: ${d.source}`,
    `beta ${num(d.beta)}  gamma ${num(d.gamma)}  accel ${d.accel ? d.accel.map(num).join(' ') : '-'}`,
    `turn ${deg(d.turn)}  level at ${deg(d.zero)}  -> lean ${controls.tiltLean?.toFixed(2) ?? 'none'}`,
    `tilting ${controls.tilting}  assist ${controls.assist}  roll ${deg(boat.roll)}`,
    `twist ${deg(d.twist)}  -> rudder ${controls.twistRudder.toFixed(2)} (push the right side forward: left)`,
    `settings: full lean at ${deg(TILT_FULL)}, reflex ${TILT_REFLEX}, levels over ${TILT_SETTLE} s`,
  ].join('\n');
}

function updateHud(dt) {
  showTilt(dt);
  if (state === 'racing') engines(dt);
  if (flashTimer > 0) {
    flashTimer -= dt;
    if (flashTimer <= 0) flash.classList.remove('show');
  }
  const { boat, loc } = race.player;
  document.body.classList.toggle('capsized', boat.swim > 0);
  if (hud.hidden) return;
  const { course } = race;
  const togo = Math.max(0, Math.min(course.finish - course.start, course.finish - loc.s)) * course.warp / course.speedup;
  els.clock.textContent = race.format !== 'interval' ? formatTime(shown(race.player.finish ?? race.time))
    : race.player.crossed === null && race.time < race.player.release ? `Start in ${Math.ceil(race.player.release - race.time)}`
    : formatTime(shown(elapsed(race, race.player)));
  els.togo.textContent = course.warp > 1 ? `${(togo / 1000).toFixed(2)} km` : `${Math.ceil(togo)} m`;
  els.pos.textContent = `${ordinal(standings(race).indexOf(race.player) + 1)} / ${race.racers.length}`;
  els.wash.classList.toggle('on', race.player.draft > 0.3 && state === 'racing');
  els.speed.textContent = (boat.speed * 3.6).toFixed(1);
  els.rate.textContent = boat.hull.scull ? scullRate(boat) : strokeRate(boat);
  els.stamina.style.transform = `scaleX(${boat.stamina.toFixed(3)})`;
  els.stamina.parentElement.classList.toggle('spending', boat.sprinting && boat.stamina > 0);
  if (!race.outing && !boat.hull.scull) {
    sprintHint(boat, dt);
    stuckHint(boat, dt);
  }
  els.flow.textContent = boat.flow > 0.05 ? `+${(boat.flow * boat.hull.flowBonus * 100).toFixed(0)}%` : '';
  showPlace(course, loc.s, dt);
  if (!race.outing) showCue(course, loc.s, dt);
  els.drill.hidden = !drill?.readout;
  if (drill) els.drill.textContent = drill.readout;
  moveMap();
  els.rhythm.style.transform = `scaleX(${boat.rhythm.toFixed(3)})`;
  els.rhythm.parentElement.classList.toggle('locked', boat.rhythm > 0.9);
  hud.classList.toggle('assisted', controls.assist);
  // On phones, the controls in a line until a little way into the race.
  hud.classList.toggle('helping', phone.matches && (state === 'start' || (state === 'racing' && race.time < 6)));
  els.rudder.style.transform = `translateX(${(controls.rudder * 39).toFixed(1)}px)`;
  const angle = Math.max(-1.1, Math.min(1.1, boat.roll / (boat.hull.scull ? boat.hull.crabAt : BOAT.capsize))) * 90;
  els.needle.style.transform = `rotate(${angle.toFixed(1)}deg)`;
}

// The course map: its shape once per race, then a dot per boat each frame (an
// arrow for you, pointing where you're heading). And the close-up beside it:
// the water near you, turned each frame so ahead is up, you in the middle.
const SVG = 'http://www.w3.org/2000/svg';
let map = null; // { project, dots: Map(racer -> element), world, near: Map(racer -> element) }

function drawMap() {
  const shape = courseMap(race.course);
  const el = (name, attrs) => {
    const e = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const water = closeUp(race.course);
  const line = ([x1, y1, x2, y2], cls) => el('line', { x1, y1, x2, y2, class: cls });
  const world = el('g', {});
  world.append(el('path', { d: water.water, class: 'water', 'fill-rule': water.rule }), el('path', { d: water.line, class: 'route' }),
    line(water.start, 'start'), line(water.finish, 'finish'));
  // Turning buoys, on both maps.
  const marks = race.course.scenery?.marks ?? [];
  for (const m of marks) world.append(el('circle', { cx: m.x, cy: m.z, r: 2.2, class: 'buoy' }));
  // The other boats: their hulls to scale, and a rowing boat's oars across.
  const boats = new Map();
  for (const b of race.traffic?.boats ?? []) {
    const T = TRAFFIC[b.kind];
    const g = el('g', { class: 'boat' });
    g.append(el('rect', { x: -Math.max(T.hull, 0.6), y: -T.length / 2, width: 2 * Math.max(T.hull, 0.6), height: T.length, rx: 0.6 }));
    if (T.oars) g.append(line([-T.oars[2], 0, T.oars[2], 0], 'oars'));
    world.append(g);
    boats.set(b, g);
  }
  const near = new Map();
  for (const r of race.racers.filter((x) => x !== race.player)) {
    const dot = el('circle', { r: 3, class: r.remote ? 'friend' : 'rival' });
    world.append(dot);
    near.set(r, dot);
  }
  els.near.replaceChildren(world, el('path', { d: 'M0 -6L4.5 4.5L0 2.2L-4.5 4.5Z', class: 'you' }));
  const tick = ([x, y], cls) => el('circle', { cx: x, cy: y, r: 3, class: cls });
  els.map.setAttribute('viewBox', `0 0 ${shape.width} ${shape.height}`);
  els.map.style.aspectRatio = `${shape.width} / ${shape.height}`;
  els.map.classList.toggle('tall', shape.height > shape.width);
  els.map.replaceChildren(el('path', { d: shape.d, class: 'line' }), tick(shape.start, 'start'), tick(shape.finish, 'finish'));
  for (const m of marks) els.map.append(el('circle', { cx: shape.project(m.x, m.z)[0], cy: shape.project(m.x, m.z)[1], r: 1.8, class: 'buoy' }));
  const far = new Map();
  for (const b of race.traffic?.boats ?? []) {
    const dot = el('circle', { r: 1.8, class: 'boat' });
    els.map.append(dot);
    far.set(b, dot);
  }
  const dots = new Map();
  // Others first, so you're drawn on top.
  for (const r of [...race.racers.filter((x) => x !== race.player), race.player]) {
    const dot = r === race.player ? el('path', { d: 'M0 -5.5L4 4L0 2L-4 4Z', class: 'you' }) : el('circle', { r: 2.6, class: r.remote ? 'friend' : 'rival' });
    els.map.append(dot);
    dots.set(r, dot);
  }
  map = { project: shape.project, dots, world, near, boats, far };
}

function moveMap() {
  if (!map) return;
  for (const [r, dot] of map.dots) {
    const [x, y] = map.project(r.boat.x, r.boat.z);
    const turn = r === race.player ? ` rotate(${headingDegrees(r.boat.heading).toFixed(0)})` : '';
    dot.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})${turn}`);
    dot.style.opacity = r.finish !== null && r !== race.player ? 0.4 : 1;
  }
  map.world.setAttribute('transform', follow(race.player.boat));
  for (const [b, g] of map.boats) {
    g.style.display = b.on ? '' : 'none';
    if (b.on) g.setAttribute('transform', `translate(${b.x.toFixed(1)} ${b.z.toFixed(1)}) rotate(${headingDegrees(b.heading).toFixed(0)})`);
  }
  for (const [b, dot] of map.far) {
    dot.style.display = b.on ? '' : 'none';
    if (!b.on) continue;
    const [x, y] = map.project(b.x, b.z);
    dot.setAttribute('cx', x.toFixed(1));
    dot.setAttribute('cy', y.toFixed(1));
  }
  for (const [r, dot] of map.near) {
    dot.setAttribute('cx', r.boat.x.toFixed(1));
    dot.setAttribute('cy', r.boat.z.toFixed(1));
    dot.style.opacity = r.finish !== null ? 0.4 : 1;
  }
}

// Landmarks (a real river's course.scenery.places) named one at a time as you
// come up to them, each for a few seconds; any already passed are skipped.
// Getting nowhere for a few seconds mid-race (nosed into a bank, or turned
// round in a narrow gap where the rudder can't bring you back): how to back
// out. A back stroke swings the bow towards its side, so it turns you on the spot.
function stuckHint(boat, dt) {
  const { loc } = race.player;
  const going = state === 'racing' && race.player.finish === null && boat.swim <= 0 && released(race, race.player);
  if (!going || loc.s > stuck.s + 3) Object.assign(stuck, { s: loc.s, for: 0 });
  else stuck.for += dt;
  if (stuck.left <= 0 || stuck.for < 3) return;
  show(phone.matches ? 'Stuck? Swipe down to paddle backwards and turn' : 'Stuck? Hold ↓ and paddle to go backwards and turn', { small: true, hold: 3.5 });
  Object.assign(stuck, { left: stuck.left - 1, for: -10 });
}

// Tells you about the sprint when it would help: stamina to spare, and a boat
// a little way ahead to catch. A few times a race at most.
function sprintHint(boat, dt) {
  hints.wait -= dt;
  if (state !== 'racing' || hints.left <= 0 || hints.wait > 0 || boat.sprinting || boat.stamina < 0.8) return;
  const { loc } = race.player;
  const k = race.course.speedup ?? 1;
  const ahead = race.racers.some((r) => r !== race.player && r.finish === null
    && r.loc.s - loc.s > 14 * k && r.loc.s - loc.s < 40 * k && Math.abs(r.loc.lateral - loc.lateral) < 8);
  if (!ahead) return;
  show('Paddle quicker than 90 a minute to sprint onto their wash', { small: true, hold: 2.5 });
  hints = { left: hints.left - 1, wait: 30 };
}

// Coming up to a turn or a split (a course file's `cues`): which way, with an
// arrow, for a few seconds. And a gate missed (race.js): which way to go back,
// until you have.
const TURN = { left: '\u21b0', right: '\u21b1', either: '\u21c5' };
let cueNext = 0;
let cueTimer = 0;
function showCue(course, s, dt) {
  const list = course.scenery?.cues ?? [];
  cueTimer -= dt;
  while (list[cueNext] && s > list[cueNext].s + 60) cueNext++;
  if (list[cueNext] && s > list[cueNext].s) {
    const c = list[cueNext++];
    els.cueArrow.textContent = TURN[c.turn] ?? '';
    els.cueText.textContent = c.text;
    els.cue.className = `on ${c.turn}`;
    cueTimer = 5;
    tone({ freq: 660, to: 880, duration: 0.12, type: 'sine', gain: 0.06 });
  }
  if (cueTimer <= 0) els.cue.classList.remove('on');
  const missed = race.player.missed;
  els.missed.hidden = !missed;
  if (missed) els.missed.textContent = `Missed the course: go back and go ${missed.label}`;
}

function showPlace(course, s, dt) {
  const list = course.scenery?.places ?? [];
  placeTimer -= dt;
  while (list[placeNext] && s > list[placeNext].s + 30) placeNext++;
  if (placeTimer <= 0 && list[placeNext] && s > list[placeNext].s - 60) {
    els.place.textContent = list[placeNext++].name;
    placeTimer = 3.5;
  }
  els.place.classList.toggle('on', placeTimer > 0.8);
}

// --- main loop ---------------------------------------------------------------

let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  handleGamepad(controls.poll(dt));
  if (state === 'start' || state === 'racing' || state === 'finished') {
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP;
      simulate(STEP);
    }
  } else {
    acc = 0;
    // Behind the menu the boats just sit there, gently rocking.
    if (state === 'menu') for (const r of race.racers) r.boat.time += dt;
  }
  updateHud(dt);
  stepLook(dt);
  if (club) stepClub(dt);
  if (ergRun) stepErgRun(dt);
  render(now / 1000);
  requestAnimationFrame(frame);
}

function formatTime(t, digits = 1) {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(digits).padStart(digits ? 3 + digits : 2, '0');
  return `${m}:${s}`;
}

function ordinal(n) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

function apply(m, [x, y, z]) {
  return [0, 1, 2].map((i) => m[i] * x + m[4 + i] * y + m[8 + i] * z + m[12 + i]);
}

function normalize(v) {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
}

// Each racer's boat in their colours, built the first time that colour and
// hull width are needed; likewise each paddler.
function kayakFor(r) {
  const l = liveries.get(r);
  const { beam } = r.boat.hull;
  const key = `${l.key}:${beam}`;
  if (!meshes.kayaks.has(key)) meshes.kayaks.set(key, renderer.createMesh(kayakMesh({ ...l, beam })));
  return meshes.kayaks.get(key);
}
// Rivals all paddle with the same yellow wing blades; you and your friends with your own.
const RIVAL_PADDLE = { key: 'rival', shaft: [0.22, 0.23, 0.26], blade: [1, 0.82, 0.2] };
function paddleFor(r) {
  const l = liveries.get(r);
  const p = l.shaft ? { key: `${l.flat}:${l.shaft}:${l.blade}`, ...l } : RIVAL_PADDLE;
  if (!meshes.paddles.has(p.key)) meshes.paddles.set(p.key, renderer.createMesh(paddleMesh(p), LIVERIES.length));
  return meshes.paddles.get(p.key);
}
function paddlerFor(r) {
  return paddlerOf(liveries.get(r));
}
function paddlerOf(l) {
  if (!meshes.racers.has(l.key)) {
    meshes.racers.set(l.key, {
      body: renderer.createMesh(paddlerMesh(l)),
      arms: renderer.createMesh(limbMesh(l.top, { skin: l.skin, sleeve: l.sleeves === 'short' ? 0.4 : l.sleeves === 'none' ? 0 : 1 }), 2),
    });
  }
  return meshes.racers.get(l.key);
}

// The scenery is built the first time each course is raced: the river once for
// every course on it (they're all on the one at Reading), and each course's own
// buoys, start and finish.
const worldOf = (m) => m.course.world ?? m.key;
function useWorld() {
  if (!meshes.worlds.has(worldOf(mode))) {
    const world = renderer.createMesh(buildWorld(mode.course, 1, 'river'));
    renderer.place(world, [translation(0, 0, 0)]);
    meshes.worlds.set(worldOf(mode), world);
  }
  if (!meshes.marks.has(mode)) {
    const marks = renderer.createMesh(buildWorld(mode.course, 1, 'course'));
    renderer.place(marks, [translation(0, 0, 0)]);
    meshes.marks.set(mode, marks);
  }
}

// --- start up ----------------------------------------------------------------

// Lets automated playtests read the race from outside: open the page with #debug.
if (HASH.has('debug')) {
  window.kayak = {
    get race() { return race; },
    get boat() { return race.player.boat; },
    get loc() { return race.player.loc; },
    get course() { return race.course; },
    get state() { return state; },
    get gpu() { return renderer?.stats; },
    get look() { return lookBack; }, // in a scull: -1 over the left shoulder, 1 over the right
    get tilt() { return controls.tiltLean; },
    get live() { return liveRace; },
    get lobby() { return lobby; },
    get liveries() { return liveries; },
    get club() { return club; },
    clubAt: (place) => arrive(place),
  };
}

// The menu opens over the first course; the others load when picked.
try {
  mode.course = await loadCourse(mode.file);
} catch (err) {
  els.nogpu.hidden = false;
  els.nogpu.textContent = `${err.message} Check your connection and reload the page.`;
  throw err;
}
reset();
toMenu();
whoAmI().then((a) => {
  account = a;
  showAccount();
  if (account.user) loadKit();
  // Opened from a live race's link.
  if (HASH.get('race') && state === 'menu') {
    menu.close('');
    openLive(HASH.get('race').toUpperCase());
  }
});
try {
  renderer = await createRenderer(canvas);
  meshes = {
    worlds: new Map(),
    marks: new Map(),
    paddles: new Map(),
    // Room for the outings' busier river (outing.js BUSY): some 20 boats on the water at once.
    traffic: { sculler: renderer.createMesh(scullerMesh(), 24), kayaker: renderer.createMesh(kayakerMesh(), 24), eight: renderer.createMesh(eightMesh(), 24), cruiser: renderer.createMesh(cruiserMesh(), 24), motorboat: renderer.createMesh(motorboatMesh(), 24) },
    oar: renderer.createMesh(oarMesh(), 256),
    trafficPaddle: renderer.createMesh(paddleMesh(RIVAL_PADDLE), 24),
    swimmer: renderer.createMesh(swimmerMesh(), 24),
    kayaks: new Map(),
    swan: renderer.createMesh(swanMesh(), BIRDS_DRAWN),
    duck: renderer.createMesh(duckMesh(), BIRDS_DRAWN),
    racers: new Map(),
    outing: { cruise: renderer.createMesh(tripBoatMesh()), hire: renderer.createMesh(launchMesh()) },
  };
  useWorld();
  requestAnimationFrame(frame);
} catch (err) {
  els.nogpu.hidden = false;
  els.nogpu.textContent = `${err.message} Kayak needs WebGPU or WebGL 2: try a current version of Chrome, Edge, Safari or Firefox.`;
  for (const b of menu.querySelectorAll('form button')) b.disabled = true;
  if (walking) {
    walking = false;
    visit.from = 'menu';
    leaveClub();
    showStep('home');
    openDialog(menu);
  }
}
