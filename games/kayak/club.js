// The walk to the club (prototype, opened with #club): before a race you stand
// on the Thames at Reading and go from place to place, each a fixed camera shot
// with doors to tap. Reading Canoe Club (the kayak game) is on the north bank,
// Reading Rowing Club across the river (red boards out: no rowing today). At the
// canoe club: the changing room (your paddler), the boathouse (your boat and
// paddle), the clubhouse (the plan and the leaderboards) and the pontoon (off to
// the race). Pure: no DOM; main.js draws the shots and the doors.
import { MeshBuilder } from './meshes.js';
import { locate, pointAt, widthAt } from './course.js';
import { groundAt } from './world.js';

// Where each place's doors lead. 'rowing' isn't a place: its door says why not.
export const PLACES = {
  path: { label: 'The Thames at Reading', doors: ['club', 'rowing'] },
  club: { label: 'Reading Canoe Club', doors: ['changing', 'boathouse', 'clubhouse', 'pontoon', 'path'] },
  changing: { label: 'The changing room', doors: ['club'], inside: true },
  boathouse: { label: 'The boathouse', doors: ['club'], inside: true },
  clubhouse: { label: 'The clubhouse', doors: ['club'], inside: true },
  pontoon: { label: 'The pontoon', doors: ['club'] },
};
export const DOOR_LABELS = {
  club: 'Reading Canoe Club', rowing: 'Reading Rowing Club', changing: 'Changing room', boathouse: 'Boathouse',
  clubhouse: 'Clubhouse', pontoon: 'Go to the water', path: 'Back to the path',
};
// Where the walk starts: a race link brings you to the club (the host made the
// plan); otherwise the path, or wherever you were last.
export function firstPlace({ invited = false, last = null } = {}) {
  if (invited) return 'club';
  return PLACES[last] && !PLACES[last].inside ? last : 'path';
}

// The rooms are built under the club, out of sight of the river: each is a box
// you stand in, so the sky and the water never show.
const UNDER = -60;
export const PATH = { height: 9.8, lean: 5.5, aside: 7, back: 11 }; // the eye on Caversham Bridge (how high, how far over the parapet); how far back from the club you stand
export const ROOMS = {
  changing: { at: 0, width: 10, depth: 8, height: 3.4 },
  boathouse: { at: 1, width: 13, depth: 10, height: 3.6 },
  clubhouse: { at: 2, width: 10, depth: 8, height: 3.4 },
};

const add = (a, b, k = 1) => a.map((v, i) => v + b[i] * k);
const centre = (shape) => shape.reduce((a, p) => [a[0] + p[0] / shape.length, a[1] + p[1] / shape.length], [0, 0]);

// The camera shots and the doors' places in the world (for their labels), from
// the clubs' mapped buildings and the river beside them.
export function clubShots(course) {
  const river = course.scenery.river ?? course;
  const building = (style) => course.scenery.buildings.find((b) => b.style === style);
  const canoe = building('canoe-club');
  const rowing = building('rowing-club');
  if (!canoe || !rowing) return null;
  const at = (x, z, up) => [x, groundAt(course, x, z) + up, z];
  const frame = (b) => {
    const [x, z] = centre(b.shape);
    const l = locate(river, x, z);
    const p = pointAt(river, l.s);
    const w = widthAt(river, l.s).half;
    const len = Math.hypot(p.x - x, p.z - z) || 1;
    const toWater = [(p.x - x) / len, 0, (p.z - z) / len];
    // The club's own water's edge: from the river line, back across the water towards it.
    const edge = [p.x - toWater[0] * w, 0, p.z - toWater[2] * w];
    return { x, z, toWater, along: [-toWater[2], 0, toWater[0]], edge, height: b.height ?? 6, toEdge: Math.hypot(edge[0] - x, edge[2] - z) };
  };
  const c = frame(canoe);
  const r = frame(rowing);
  const roomAt = (name) => [c.x + ROOMS[name].at * 40, UNDER, c.z];
  // Inside a room: stand by the wall you came in at, look across to the far one.
  const room = (name, lookUp = 1.3) => {
    const o = roomAt(name);
    const { depth } = ROOMS[name];
    return { eye: add(o, [0, 1.65, depth / 2 - 0.6]), look: add(o, [0, lookUp, -depth / 2]) };
  };
  // The way out: a door at the far end of the right-hand wall.
  const out = (name) => add(roomAt(name), [ROOMS[name].width / 2 - 0.2, 2.5, -ROOMS[name].depth / 2 + 1.8]);
  const pontoon = add(c.edge, c.toWater, -1.5);
  // The opening shot: on Caversham Bridge's deck, looking up the river at both clubs.
  const deck = course.scenery.bridges?.find((b) => b.name === 'Caversham Bridge');
  const ds = deck ? deck.s : locate(river, (c.x + r.x) / 2, (c.z + r.z) / 2).s - 200;
  const on = pointAt(river, ds);
  const ahead = pointAt(river, (locate(river, r.x, r.z).s + locate(river, c.x, c.z).s) / 2);
  // Leaning on the upstream parapet, so the bridge itself is out of the shot.
  const lean = [on.tx * PATH.lean - on.tz * PATH.aside, 0, on.tz * PATH.lean + on.tx * PATH.aside];
  const bridge = { eye: [on.x + lean[0], PATH.height, on.z + lean[2]], look: [ahead.x, 5, ahead.z] };
  // The club from the road: on its land side, looking at the door.
  const entrance = at(...add([c.x, 0, c.z], c.toWater, -(c.toEdge + PATH.back)).filter((_, i) => i !== 1), 1.7);
  const entranceDoor = (k) => at(...add(add([c.x, 0, c.z], c.toWater, -c.toEdge * 0.6), c.along, k).filter((_, i) => i !== 1), 1.8);
  const across = add([r.x, 0, r.z], r.toWater, r.toEdge);
  return {
    places: {
      // Along the club's bank, on the side away from the rowing club, near the
      // water: the canoe club near, the rowing club across the river beyond it.
      path: bridge,
      club: { eye: entrance, look: at(c.x, c.z, 2.6) },
      pontoon: { eye: [pontoon[0], 1.6, pontoon[2]], look: [across[0], 0.6, across[2]] },
      changing: room('changing'),
      boathouse: room('boathouse', 1.5),
      clubhouse: room('clubhouse', 1.5),
    },
    doors: {
      path: { club: at(c.x, c.z, c.height + 40), rowing: at(r.x, r.z, 0) },
      club: { changing: entranceDoor(-10), boathouse: entranceDoor(0), clubhouse: entranceDoor(10), pontoon: at(...add([c.x, 0, c.z], c.along, 24).filter((_, i) => i !== 1), -0.4), path: at(...add(add([c.x, 0, c.z], c.toWater, -(c.toEdge + PATH.back - 2)), c.along, -10).filter((_, i) => i !== 1), 1.4) },
      changing: { club: out('changing') },
      boathouse: { club: out('boathouse') },
      clubhouse: { club: out('clubhouse') },
      pontoon: { club: add(c.edge, c.toWater, -8).map((v, i) => (i === 1 ? 1.5 : v)) },
    },
    // Where the boathouse's boats lie on the rack, and the whiteboard and the leaderboard on the clubhouse wall.
    rack: rackPlaces(roomAt('boathouse')),
    // Each boat's label at one end, alternating, so the shelves' labels don't stack.
    rackLabels: rackPlaces(roomAt('boathouse')).map((p, i) => add(p, [(i < 5 ? -1 : 1) * (2.9 + (i % 2) * 0.55), 0.05, 0])),
    paddles: add(roomAt('boathouse'), [-ROOMS.boathouse.width / 2 + 0.3, 2.5, -ROOMS.boathouse.depth / 2 + 2.6]),
    boards: { plan: add(roomAt('clubhouse'), [-2.3, 1.75, -ROOMS.clubhouse.depth / 2 + 0.1]), leaders: add(roomAt('clubhouse'), [2.2, 1.75, -ROOMS.clubhouse.depth / 2 + 0.1]) },
    changingSeat: add(roomAt('changing'), [0, 0.48, -ROOMS.changing.depth / 2 + 1.2]),
    rowingSign: at(...add(across, r.toWater, -2).filter((_, i) => i !== 1), 0),
    roomAt,
  };
}

// The nine boats on two racks along the boathouse's back wall, side on: the
// tippiest at the bottom left, five shelves on the left and four on the right.
export const SHELF = 0.62;
function rackPlaces(o) {
  return Array.from({ length: 9 }, (_, i) => {
    const [rack, shelf] = i < 5 ? [-1, i] : [1, i - 5];
    return add(o, [rack * 3.1, 0.42 + shelf * SHELF, -ROOMS.boathouse.depth / 2 + 0.7]);
  });
}

// A camera part of the way from one shot to the next (t 0..1, eased at both ends).
export function glide(a, b, t) {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  return { eye: a.eye.map((v, i) => v + (b.eye[i] - v) * k), look: a.look.map((v, i) => v + (b.look[i] - v) * k) };
}

const C = {
  tile: [0.82, 0.84, 0.82], wall: [0.86, 0.83, 0.76], timber: [0.55, 0.4, 0.26], dark: [0.32, 0.24, 0.17],
  locker: [0.35, 0.48, 0.62], bench: [0.62, 0.46, 0.3], mirror: [0.72, 0.84, 0.9], rack: [0.3, 0.3, 0.32],
  white: [0.95, 0.95, 0.93], board: [0.12, 0.2, 0.18], frame: [0.4, 0.3, 0.2], glass: [0.7, 0.82, 0.86], gold: [0.92, 0.74, 0.2],
  red: [0.86, 0.1, 0.08], post: [0.9, 0.9, 0.88], floor: [0.5, 0.38, 0.27],
};

// A room: floor, four walls and a ceiling, `size` big at `o`.
function shell(m, o, size, floor) {
  const { width: w, depth: d, height: h } = size;
  const [x0, x1, z0, z1] = [o[0] - w / 2, o[0] + w / 2, o[2] - d / 2, o[2] + d / 2];
  const [y0, y1] = [o[1], o[1] + h];
  m.box([x0 - 0.2, y0 - 0.2, z0 - 0.2], [x1 + 0.2, y0, z1 + 0.2], floor);
  m.box([x0 - 0.2, y1, z0 - 0.2], [x1 + 0.2, y1 + 0.2, z1 + 0.2], C.white);
  m.box([x0 - 0.2, y0, z0 - 0.2], [x0, y1, z1 + 0.2], C.wall);
  m.box([x1, y0, z0 - 0.2], [x1 + 0.2, y1, z1 + 0.2], C.wall);
  m.box([x0, y0, z0 - 0.2], [x1, y1, z0], C.wall);
  m.box([x0, y0, z1], [x1, y1, z1 + 0.2], C.wall);
  // The way out: a door at the far end of the right-hand wall.
  m.box([x1 - 0.05, y0, z0 + 1.3], [x1, y0 + 2.1, z0 + 2.3], C.dark);
}

// The three rooms under the club, and the red boards outside the rowing club.
// Your paddler, boats and paddles are placed in them by main.js.
export function clubMesh(shots) {
  const m = new MeshBuilder();
  const { roomAt } = shots;
  // Changing room: lockers along the back wall, a bench, a mirror.
  const a = roomAt('changing');
  const back = a[2] - ROOMS.changing.depth / 2;
  shell(m, a, ROOMS.changing, C.tile);
  for (let i = 0; i < 8; i++) {
    const x = a[0] - 4.2 + i * 0.75;
    m.box([x, a[1], back], [x + 0.7, a[1] + 1.9, back + 0.5], i % 2 ? C.locker : C.locker.map((v) => v * 0.9));
  }
  m.box([a[0] - 2.5, a[1] + 0.4, back + 0.9], [a[0] + 2.5, a[1] + 0.48, back + 1.5], C.bench);
  m.box([a[0] + 3.2, a[1] + 0.9, back + 0.51], [a[0] + 4.4, a[1] + 2.3, back + 0.55], C.mirror);
  // Boathouse: a timber floor, two racks on the back wall (uprights and arms).
  const b = roomAt('boathouse');
  const wall = b[2] - ROOMS.boathouse.depth / 2;
  shell(m, b, ROOMS.boathouse, C.floor);
  for (const [rack, shelves] of [[-1, 5], [1, 4]]) {
    for (const x of [-1.8, 0, 1.8]) {
      const px = b[0] + rack * 3.1 + x;
      m.box([px - 0.05, b[1], wall], [px + 0.05, b[1] + 0.4 + shelves * SHELF, wall + 0.1], C.rack);
      for (let k = 0; k < shelves; k++) m.box([px - 0.04, b[1] + 0.36 + k * SHELF, wall], [px + 0.04, b[1] + 0.4 + k * SHELF, wall + 1.2], C.rack);
    }
  }
  // Paddles on the left-hand wall: a wing and a flat, blades up.
  for (const [k, z] of [[0, 2], [1, 3.1]]) {
    const pz = wall + z;
    const px = b[0] - ROOMS.boathouse.width / 2 + 0.06;
    m.box([px, b[1] + 0.3, pz - 0.02], [px + 0.04, b[1] + 2.4, pz + 0.02], C.rack);
    m.box([px, b[1] + 1.95, pz - (k ? 0.1 : 0.13)], [px + 0.03, b[1] + 2.45, pz + (k ? 0.1 : 0.07)], k ? C.locker : C.gold);
    m.box([px, b[1] + 0.25, pz - (k ? 0.1 : 0.13)], [px + 0.03, b[1] + 0.75, pz + (k ? 0.1 : 0.07)], k ? C.locker : C.gold);
  }
  // Clubhouse: a whiteboard and a leaderboard on the back wall, a trophy cabinet in the corner.
  const c = roomAt('clubhouse');
  shell(m, c, ROOMS.clubhouse, C.floor);
  const cwall = c[2] - ROOMS.clubhouse.depth / 2;
  m.box([c[0] - 4.2, c[1] + 0.9, cwall], [c[0] - 0.4, c[1] + 2.6, cwall + 0.06], C.frame);
  m.box([c[0] - 4.1, c[1] + 1, cwall + 0.06], [c[0] - 0.5, c[1] + 2.5, cwall + 0.08], C.white);
  m.box([c[0] + 0.6, c[1] + 0.9, cwall], [c[0] + 3.8, c[1] + 2.6, cwall + 0.06], C.frame);
  m.box([c[0] + 0.7, c[1] + 1, cwall + 0.06], [c[0] + 3.7, c[1] + 2.5, cwall + 0.08], C.board);
  m.box([c[0] - 4.6, c[1], cwall + 1.5], [c[0] - 3.8, c[1] + 1.8, cwall + 2.4], C.glass);
  for (let i = 0; i < 3; i++) m.cylinder([c[0] - 4.2, c[1] + 0.4 + i * 0.5, cwall + 1.95], 0.1, 0.3, 6, C.gold);
  // The red boards: a red board on a white post at the rowing club's landing.
  const s = shots.rowingSign;
  m.cylinder([s[0], s[1], s[2]], 0.08, 3.2, 6, C.post);
  m.box([s[0] - 1.1, s[1] + 2.4, s[2] - 0.05], [s[0] + 1.1, s[1] + 3.4, s[2] + 0.05], C.red);
  return m.build();
}
