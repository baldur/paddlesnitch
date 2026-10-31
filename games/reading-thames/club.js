// The walk to the club (what the game opens on): before a race you stand on the
// Thames at Reading and go from place to place, each a fixed camera shot with
// doors to tap. Reading Canoe Club (the kayak) is on the north bank: the
// changing room (your paddler), the boathouse (your boat and paddle), the
// clubhouse (the plan and the leaderboards) and the pontoon (off to the race).
// Reading Rowing Club (the single scull) is across the river: its changing
// room (your all-in-one), boathouse (the sculls), clubhouse (the plan), the erg
// room (a 500 m on the ergs, under the mural) and the landing stage. Pure: no
// DOM; main.js draws the shots and the doors.
import { MeshBuilder } from './meshes.js';
import { locate, pointAt, widthAt } from './course.js';
import { groundAt, bridgeBay, BRIDGE } from './world.js';

// Where each place's doors lead. `up` is where Back goes: the rooms and the
// pontoon are in their club, the clubs are off the bridge. `club` says whose.
export const PLACES = {
  path: { label: 'The Thames at Reading', doors: ['club', 'rclub'], up: null },
  club: { label: 'Reading Canoe Club', doors: ['changing', 'boathouse', 'clubhouse', 'pontoon', 'path'], up: 'path' },
  changing: { label: 'The changing room', doors: ['club'], inside: true, up: 'club' },
  boathouse: { label: 'The boathouse', doors: ['club'], inside: true, up: 'club' },
  clubhouse: { label: 'The clubhouse', doors: ['club'], inside: true, up: 'club' },
  pontoon: { label: 'The pontoon', doors: ['club'], up: 'club' },
  rclub: { label: 'Reading Rowing Club', doors: ['rchanging', 'rboathouse', 'rclubhouse', 'erg', 'rpontoon', 'path'], up: 'path', club: 'rowing' },
  rchanging: { label: 'The changing room', doors: ['rclub'], inside: true, up: 'rclub', club: 'rowing' },
  rboathouse: { label: 'The boathouse', doors: ['rclub'], inside: true, up: 'rclub', club: 'rowing' },
  rclubhouse: { label: 'The clubhouse', doors: ['rclub'], inside: true, up: 'rclub', club: 'rowing' },
  erg: { label: 'The erg room', doors: ['rclub'], inside: true, up: 'rclub', club: 'rowing' },
  rpontoon: { label: 'The landing stage', doors: ['rclub'], up: 'rclub', club: 'rowing' },
};
export const START = 'path';
export const DOOR_LABELS = {
  club: 'Reading Canoe Club', rowing: 'Reading Rowing Club', changing: 'Changing room', boathouse: 'Boathouse',
  clubhouse: 'Clubhouse', pontoon: 'Go to the water', path: 'Back to the path',
  rclub: 'Reading Rowing Club', rchanging: 'Changing room', rboathouse: 'Boathouse', rclubhouse: 'Clubhouse', erg: 'Erg room', rpontoon: 'Go to the water',
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
// On Caversham Bridge (world.js bridgeBay): standing at the upstream kerb
// this far back from the parapet, looking out through the viewing bay; the
// swan paces the bay's paving in front of you, this far either side of its middle.
export const STANDING = { back: 5.4, eye: 1.75 };
export const SWAN_WALK = 2.4;
export const PATH = { height: 9.8, lean: 5.5, aside: 7, back: 11 }; // the eye on Caversham Bridge (how high, how far over the parapet); how far back from the club you stand
export const HIPS = 0.9; // a standing paddler's hips above the floor (the paddler mesh starts at the hips)
export const ROOMS = {
  changing: { at: 0, width: 10, depth: 8, height: 3.4 },
  boathouse: { at: 1, width: 13, depth: 10, height: 3.6 },
  clubhouse: { at: 2, width: 10, depth: 8, height: 3.4 },
  // Under the rowing club.
  rchanging: { at: 0, width: 10, depth: 8, height: 3.4, club: 'rowing' },
  rboathouse: { at: 1, width: 14, depth: 10, height: 3.6, club: 'rowing' },
  rclubhouse: { at: 2, width: 10, depth: 8, height: 3.4, club: 'rowing' },
  erg: { at: 3, width: 12, depth: 9, height: 3.8, club: 'rowing' },
};
// The rowing club's boathouse rack: the three sculls, one above another, side on.
export const SCULL_RACK = [0.55, 1.25, 1.95];
// The erg room: two rows of ergs side on to you, the flywheels to your left;
// yours is the middle of the front row. Room coordinates (see inRoom).
export const ERGS = [-3.2, -0.6, 2, 4.6].flatMap((x) => [[x, -2.2], [x, 0.2]]);
export const MY_ERG = 3; // [-0.6, 0.2]

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
  const roomAt = (name) => {
    const home = ROOMS[name].club === 'rowing' ? r : c;
    return [home.x + ROOMS[name].at * 40, UNDER, home.z];
  };
  const p = (name, x, y, z) => inRoom(roomAt(name), x, y, z);
  // Inside a room: stand by the wall you came in at, look across to the far one.
  const room = (name, lookUp = 1.3) => {
    const { depth } = ROOMS[name];
    return { eye: p(name, 0, 1.65, depth / 2 - 0.6), look: p(name, 0, lookUp, -depth / 2) };
  };
  // Your paddler stands in the changing room, hips this high, facing the camera.
  const stand = p('changing', -1.2, HIPS, 0.4);
  // The way out: a door at the far end of the right-hand wall.
  const out = (name) => p(name, ROOMS[name].width / 2 - 0.2, 2.5, -ROOMS[name].depth / 2 + 1.8);
  const pontoon = add(c.edge, c.toWater, -1.5);
  // The opening shot: on Caversham Bridge's deck, looking up the river at both clubs.
  const deck = course.scenery.bridges?.find((b) => b.name === 'Caversham Bridge');
  const ds = deck ? deck.s : locate(river, (c.x + r.x) / 2, (c.z + r.z) / 2).s - 200;
  const on = pointAt(river, ds);
  const ahead = pointAt(river, (locate(river, r.x, r.z).s + locate(river, c.x, c.z).s) / 2);
  // Standing on the upstream pavement, looking out through the viewing bay
  // towards the clubs, as in Street View (world.js draws the bay).
  const bay = bridgeBay(river, deck);
  let bridge;
  let swan = null;
  if (bay) {
    const { deck: d, half } = BRIDGE;
    const z = bay.e * (half - STANDING.back);
    const eye = bay.at(bay.t, d + STANDING.eye, z);
    // Straight out of the bay, level, so the lamps show either side and the
    // canoe club across the water between them.
    const out = bay.at(bay.t, 0, bay.e * (half + 60));
    const look = [out[0], d + 7, out[2]];
    bridge = { eye, look, wide: 100 }; // wide, as Street View: both lamps and the bay
    // The swan on the paving in front of you, pacing across the bay (so it
    // shows above the cards on a phone).
    const sz = bay.e * (half + BRIDGE.out / 2);
    swan = { from: bay.at(bay.t - SWAN_WALK, d + 0.14, sz), to: bay.at(bay.t + SWAN_WALK, d + 0.14, sz) };
    const up = [swan.to[0] - swan.from[0], swan.to[2] - swan.from[2]];
    const toYou = [eye[0] - swan.from[0], eye[2] - swan.from[2]];
    swan.side = Math.sign(-up[1] * toYou[0] + up[0] * toYou[1]) || 1;
  } else {
    const lean = [on.tx * PATH.lean - on.tz * PATH.aside, 0, on.tz * PATH.lean + on.tx * PATH.aside];
    bridge = { eye: [on.x + lean[0], PATH.height, on.z + lean[2]], look: [ahead.x, 5, ahead.z] };
  }
  // The club from the road: on its land side, looking at the door.
  const entrance = at(...add([c.x, 0, c.z], c.toWater, -(c.toEdge + PATH.back)).filter((_, i) => i !== 1), 1.7);
  const entranceDoor = (k) => at(...add(add([c.x, 0, c.z], c.toWater, -c.toEdge * 0.6), c.along, k).filter((_, i) => i !== 1), 1.8);
  const across = add([r.x, 0, r.z], r.toWater, r.toEdge);
  // The rowing club: from its land side too, its doors along the front.
  const rEntrance = at(...add([r.x, 0, r.z], r.toWater, -(r.toEdge + PATH.back)).filter((_, i) => i !== 1), 1.7);
  const rDoor = (k) => at(...add(add([r.x, 0, r.z], r.toWater, -r.toEdge * 0.6), r.along, k).filter((_, i) => i !== 1), 1.8);
  const stage = add(r.edge, r.toWater, -1.5);
  const canoeSide = add([c.x, 0, c.z], c.toWater, c.toEdge);
  const rStand = p('rchanging', -1.2, HIPS, 0.4);
  const [ex, ez] = ERGS[MY_ERG];
  return {
    places: {
      // Along the club's bank, on the side away from the rowing club, near the
      // water: the canoe club near, the rowing club across the river beyond it.
      path: bridge,
      club: { eye: entrance, look: at(c.x, c.z, 2.6) },
      pontoon: { eye: [pontoon[0], 1.6, pontoon[2]], look: [across[0], 0.6, across[2]] },
      // Face to face with your paddler, who stands on the left of the screen: the picker sheet covers the right.
      changing: { eye: p('changing', -1.2, HIPS + 0.3, 0.4 + 2.9), look: p('changing', -1.2 + 1.85, HIPS + 0.3, 0.4) },
      boathouse: room('boathouse', 1.5),
      clubhouse: room('clubhouse', 1.5),
      rclub: { eye: rEntrance, look: at(r.x, r.z, 2.6) },
      rpontoon: { eye: [stage[0], 1.6, stage[2]], look: [canoeSide[0], 0.6, canoeSide[2]] },
      rchanging: { eye: p('rchanging', -1.2, HIPS + 0.3, 0.4 + 2.9), look: p('rchanging', -1.2 + 1.85, HIPS + 0.3, 0.4) },
      rboathouse: room('rboathouse', 1.4),
      rclubhouse: room('rclubhouse', 1.5),
      // Your erg side on in front of you, the mural on the far wall above the rest.
      erg: { eye: p('erg', ex + 0.6, 1.45, ez + 3.6), look: p('erg', ex - 0.2, 1.55, -ROOMS.erg.depth / 2) },
    },
    doors: {
      club: { changing: entranceDoor(-10), boathouse: entranceDoor(0), clubhouse: entranceDoor(10), pontoon: at(...add([c.x, 0, c.z], c.along, 24).filter((_, i) => i !== 1), -0.4), path: at(...add(add([c.x, 0, c.z], c.toWater, -(c.toEdge + PATH.back - 2)), c.along, -10).filter((_, i) => i !== 1), 1.4) },
      changing: { club: out('changing') },
      boathouse: { club: out('boathouse') },
      clubhouse: { club: out('clubhouse') },
      pontoon: { club: add(c.edge, c.toWater, -8).map((v, i) => (i === 1 ? 1.5 : v)) },
      path: { club: at(c.x, c.z, c.height + 3), rclub: at(r.x, r.z, r.height + 3) },
      rclub: { rchanging: rDoor(-12), rboathouse: rDoor(-4), rclubhouse: rDoor(4), erg: rDoor(12), rpontoon: at(...add([r.x, 0, r.z], r.along, 24).filter((_, i) => i !== 1), -0.4), path: at(...add(add([r.x, 0, r.z], r.toWater, -(r.toEdge + PATH.back - 2)), r.along, -10).filter((_, i) => i !== 1), 1.4) },
      rchanging: { rclub: out('rchanging') },
      rboathouse: { rclub: out('rboathouse') },
      rclubhouse: { rclub: out('rclubhouse') },
      erg: { rclub: out('erg') },
      rpontoon: { rclub: add(r.edge, r.toWater, -8).map((v, i) => (i === 1 ? 1.5 : v)) },
    },
    // Where the boathouse's boats lie on the rack, and the whiteboard and the leaderboard on the clubhouse wall.
    rack: RACK.map(([x, y, z]) => p('boathouse', x, y, z)),
    // Each boat's label at its rack's outer end, alternating, so the shelves' labels don't stack.
    rackLabels: RACK.map(([x, y, z], i) => p('boathouse', x + (i < 5 ? -1 : 1) * (2.9 + (i % 2) * 0.55), y + 0.05, z)),
    paddles: p('boathouse', -ROOMS.boathouse.width / 2 + 0.3, 2.5, -ROOMS.boathouse.depth / 2 + 2.6),
    boards: { plan: p('clubhouse', -2.3, 1.75, -ROOMS.clubhouse.depth / 2 + 0.1), leaders: p('clubhouse', 2.2, 1.75, -ROOMS.clubhouse.depth / 2 + 0.1) },
    changingStand: stand,
    changeLabel: p('changing', -1.2 + 0.75, HIPS + 0.15, 0.4),
    swan,
    roomAt,
    // The rowing club's: you in your all-in-one, the sculls on the rack and
    // their labels, the plan's two rows, the honours board, your erg.
    rStand,
    rChangeLabel: p('rchanging', -1.2 + 0.75, HIPS + 0.15, 0.4),
    sculls: SCULL_RACK.map((y) => p('rboathouse', 0, y, -ROOMS.rboathouse.depth / 2 + 0.6)),
    scullLabels: SCULL_RACK.map((y) => p('rboathouse', 4.9, y + 0.1, -ROOMS.rboathouse.depth / 2 + 0.6)),
    paint: p('rboathouse', -4.6, 2.6, -ROOMS.rboathouse.depth / 2 + 0.6),
    rplan: [p('rclubhouse', -2.3, 2.05, -ROOMS.rclubhouse.depth / 2 + 0.1), p('rclubhouse', -2.3, 1.45, -ROOMS.rclubhouse.depth / 2 + 0.1)],
    honours: p('rclubhouse', 2.2, 1.75, -ROOMS.rclubhouse.depth / 2 + 0.1),
    ergs: ERGS.map(([x, z]) => p('erg', x, 0, z)),
    ergLabel: p('erg', ex - 0.2, 1.2, ez + 0.6),
  };
}

// Rooms are laid out as seen from where you stand (x to your right, z towards
// you, the far wall at -depth/2) and turned round so you look south: the sun
// is in the north, so you see the lit side of everything.
export function inRoom(o, x, y, z) {
  return [o[0] - x, o[1] + y, o[2] - z];
}

// The nine boats on two racks along the boathouse's back wall, side on: the
// tippiest at the bottom left, five shelves on the left and four on the right.
export const SHELF = 0.62;
const RACK = Array.from({ length: 9 }, (_, i) => {
  const [rack, shelf] = i < 5 ? [-1, i] : [1, i - 5];
  return [rack * 3.1, 0.42 + shelf * SHELF, -ROOMS.boathouse.depth / 2 + 0.7];
});

// A camera part of the way from one shot to the next (t 0..1, eased at both ends).
export const WIDE = 75; // the game's least horizontal view, degrees (main.js MIN_FOV_X)
export function glide(a, b, t) {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  const shot = { eye: a.eye.map((v, i) => v + (b.eye[i] - v) * k), look: a.look.map((v, i) => v + (b.look[i] - v) * k) };
  // A shot can ask for a wider view (`wide`: the least horizontal angle, degrees).
  if (a.wide || b.wide) shot.wide = (a.wide ?? WIDE) + ((b.wide ?? WIDE) - (a.wide ?? WIDE)) * k;
  return shot;
}

const C = {
  tile: [0.82, 0.84, 0.82], wall: [0.86, 0.83, 0.76], timber: [0.55, 0.4, 0.26], dark: [0.32, 0.24, 0.17],
  locker: [0.35, 0.48, 0.62], bench: [0.62, 0.46, 0.3], mirror: [0.72, 0.84, 0.9], rack: [0.3, 0.3, 0.32],
  white: [0.95, 0.95, 0.93], board: [0.12, 0.2, 0.18], frame: [0.4, 0.3, 0.2], glass: [0.7, 0.82, 0.86], gold: [0.92, 0.74, 0.2],
  red: [0.86, 0.1, 0.08], post: [0.9, 0.9, 0.88], floor: [0.5, 0.38, 0.27],
  maroon: [0.48, 0.12, 0.18], blade: [0.48, 0.12, 0.18], rubber: [0.18, 0.18, 0.2],
};

// A box in a room, corners in the room's own coordinates (see inRoom).
function rbox(m, o, [x0, y0, z0], [x1, y1, z1], color) {
  const a = inRoom(o, x0, y0, z0);
  const b = inRoom(o, x1, y1, z1);
  m.box([Math.min(a[0], b[0]), a[1], Math.min(a[2], b[2])], [Math.max(a[0], b[0]), b[1], Math.max(a[2], b[2])], color);
}

// A room: floor, four walls and a ceiling, `size` big at `o`.
function shell(m, o, size, floor) {
  const { width: w, depth: d, height: h } = size;
  const [x0, x1, z0, z1] = [-w / 2, w / 2, -d / 2, d / 2];
  rbox(m, o, [x0 - 0.2, -0.2, z0 - 0.2], [x1 + 0.2, 0, z1 + 0.2], floor);
  rbox(m, o, [x0 - 0.2, h, z0 - 0.2], [x1 + 0.2, h + 0.2, z1 + 0.2], C.white);
  rbox(m, o, [x0 - 0.2, 0, z0 - 0.2], [x0, h, z1 + 0.2], C.wall);
  rbox(m, o, [x1, 0, z0 - 0.2], [x1 + 0.2, h, z1 + 0.2], C.wall);
  rbox(m, o, [x0, 0, z0 - 0.2], [x1, h, z0], C.wall);
  rbox(m, o, [x0, 0, z1], [x1, h, z1 + 0.2], C.wall);
  // The way out: a door at the far end of the right-hand wall.
  rbox(m, o, [x1 - 0.05, 0, z0 + 1.3], [x1, 2.1, z0 + 2.3], C.dark);
}

// The rooms under both clubs. Your paddler, boats, paddles and the ergs are
// placed in them by main.js.
export function clubMesh(shots) {
  const m = new MeshBuilder();
  const { roomAt } = shots;
  // Changing room: lockers along the back wall, a bench, a mirror.
  const a = roomAt('changing');
  const back = -ROOMS.changing.depth / 2;
  shell(m, a, ROOMS.changing, C.tile);
  for (let i = 0; i < 8; i++) {
    const x = -4.2 + i * 0.75;
    rbox(m, a, [x, 0, back], [x + 0.7, 1.9, back + 0.5], i % 2 ? C.locker : C.locker.map((v) => v * 0.9));
  }
  rbox(m, a, [-2.5, 0.4, back + 0.9], [2.5, 0.48, back + 1.5], C.bench);
  rbox(m, a, [3.2, 0.9, back + 0.51], [4.4, 2.3, back + 0.55], C.mirror);
  // Boathouse: a timber floor, two racks on the back wall (uprights and arms).
  const b = roomAt('boathouse');
  const wall = -ROOMS.boathouse.depth / 2;
  shell(m, b, ROOMS.boathouse, C.floor);
  for (const [rack, shelves] of [[-1, 5], [1, 4]]) {
    for (const x of [-1.8, 0, 1.8]) {
      const px = rack * 3.1 + x;
      rbox(m, b, [px - 0.05, 0, wall], [px + 0.05, 0.4 + shelves * SHELF, wall + 0.1], C.rack);
      for (let k = 0; k < shelves; k++) rbox(m, b, [px - 0.04, 0.36 + k * SHELF, wall], [px + 0.04, 0.4 + k * SHELF, wall + 1.2], C.rack);
    }
  }
  // Paddles on the left-hand wall: a wing and a flat, blades up.
  for (const [k, z] of [[0, 2], [1, 3.1]]) {
    const pz = wall + z;
    const px = -ROOMS.boathouse.width / 2 + 0.06;
    const blade = k ? C.locker : C.gold;
    rbox(m, b, [px, 0.3, pz - 0.02], [px + 0.04, 2.4, pz + 0.02], C.rack);
    rbox(m, b, [px, 1.95, pz - (k ? 0.1 : 0.13)], [px + 0.03, 2.45, pz + (k ? 0.1 : 0.07)], blade);
    rbox(m, b, [px, 0.25, pz - (k ? 0.1 : 0.13)], [px + 0.03, 0.75, pz + (k ? 0.1 : 0.07)], blade);
  }
  // Clubhouse: a whiteboard and a leaderboard on the back wall, a trophy cabinet in the corner.
  const c = roomAt('clubhouse');
  shell(m, c, ROOMS.clubhouse, C.floor);
  const cw = -ROOMS.clubhouse.depth / 2;
  rbox(m, c, [-4.2, 0.9, cw], [-0.4, 2.6, cw + 0.06], C.frame);
  rbox(m, c, [-4.1, 1, cw + 0.06], [-0.5, 2.5, cw + 0.08], C.white);
  rbox(m, c, [0.6, 0.9, cw], [3.8, 2.6, cw + 0.06], C.frame);
  rbox(m, c, [0.7, 1, cw + 0.06], [3.7, 2.5, cw + 0.08], C.board);
  rbox(m, c, [-4.6, 0, cw + 1.5], [-3.8, 1.8, cw + 2.4], C.glass);
  for (let i = 0; i < 3; i++) m.cylinder(inRoom(c, -4.2, 0.4 + i * 0.5, cw + 1.95), 0.1, 0.3, 6, C.gold);
  rowingRooms(m, roomAt);
  return m.build();
}

// Under the rowing club: the changing room, the boathouse's scull rack, the
// clubhouse with the plan and the honours board, and the erg room with its
// mural. The ergs, the sculls and you are placed by main.js.
function rowingRooms(m, roomAt) {
  const a = roomAt('rchanging');
  const back = -ROOMS.rchanging.depth / 2;
  shell(m, a, ROOMS.rchanging, C.tile);
  for (let i = 0; i < 8; i++) {
    const x = -4.2 + i * 0.75;
    rbox(m, a, [x, 0, back], [x + 0.7, 1.9, back + 0.5], i % 2 ? C.maroon : C.maroon.map((v) => v * 0.85));
  }
  rbox(m, a, [-2.5, 0.4, back + 0.9], [2.5, 0.48, back + 1.5], C.bench);
  rbox(m, a, [3.2, 0.9, back + 0.51], [4.4, 2.3, back + 0.55], C.mirror);
  // The boathouse: a long rack on the back wall, three arms high, for the sculls.
  const b = roomAt('rboathouse');
  const wall = -ROOMS.rboathouse.depth / 2;
  shell(m, b, ROOMS.rboathouse, C.floor);
  for (const x of [-3.2, 0, 3.2]) {
    rbox(m, b, [x - 0.06, 0, wall], [x + 0.06, 2.4, wall + 0.12], C.rack);
    for (const y of SCULL_RACK) rbox(m, b, [x - 0.04, y - 0.12, wall], [x + 0.04, y - 0.08, wall + 1.1], C.rack);
  }
  // Oars stood in the corner, blades up.
  for (let k = 0; k < 6; k++) {
    const x = -ROOMS.rboathouse.width / 2 + 0.25 + k * 0.12;
    rbox(m, b, [x, 0, wall + 0.25], [x + 0.03, 2.9, wall + 0.28], C.white);
    rbox(m, b, [x - 0.01, 2.4, wall + 0.2], [x + 0.04, 2.95, wall + 0.32], C.blade);
  }
  // The clubhouse: the plan on a whiteboard, the honours board in dark wood with gold names.
  const c = roomAt('rclubhouse');
  shell(m, c, ROOMS.rclubhouse, C.floor);
  const cw = -ROOMS.rclubhouse.depth / 2;
  rbox(m, c, [-4.2, 0.9, cw], [-0.4, 2.6, cw + 0.06], C.frame);
  rbox(m, c, [-4.1, 1, cw + 0.06], [-0.5, 2.5, cw + 0.08], C.white);
  rbox(m, c, [0.6, 0.8, cw], [3.8, 2.8, cw + 0.06], C.dark);
  for (let i = 0; i < 9; i++) {
    const w = 1.2 + ((i * 7) % 5) * 0.25;
    rbox(m, c, [2.2 - w / 2, 2.5 - i * 0.18, cw + 0.06], [2.2 + w / 2, 2.53 - i * 0.18, cw + 0.07], C.gold);
  }
  // A pair of crossed oars over the board.
  for (const d of [-1, 1]) {
    for (let k = 0; k < 10; k++) {
      const t0 = k / 10;
      const x = 2.2 + d * (-1.6 + 3.2 * t0);
      rbox(m, c, [x - 0.17, 2.9 + 0.32 * t0 - 0.02, cw + 0.03], [x + 0.17, 2.9 + 0.32 * t0 + 0.02, cw + 0.05], k > 7 ? C.blade : C.white);
    }
  }
  // The erg room: a rubber floor, and the mural along the back wall.
  const e = roomAt('erg');
  shell(m, e, ROOMS.erg, C.rubber);
  mural(m, e, -ROOMS.erg.width / 2 + 0.3, ROOMS.erg.width / 2 - 0.3, 1.25, ROOMS.erg.height - 0.15, -ROOMS.erg.depth / 2);
}

// The mural on the erg room's wall, after the one at Reading Rowing Club: the
// regatta painted big and bright. A summer sky over the trees, the crowd on
// the bank (and a dog), the river with its boats, a sculler pulling hard on
// the left, and two huge faces looking out on the right. Flat shapes in the
// wall's plane, `u` across and `v` up, each layer a hair in front of the last.
function mural(m, o, u0, u1, v0, v1, wallZ) {
  const out = [0, 0, -1]; // towards you, once turned round (inRoom)
  const at = (u, v, layer) => inRoom(o, u, v, wallZ + 0.012 + layer * 0.004);
  const poly = (pts, color, layer) => {
    for (let i = 1; i < pts.length - 1; i++) m.triFacing(at(...pts[0], layer), at(...pts[i], layer), at(...pts[i + 1], layer), color, out);
  };
  const rect = (a, b, c, d, color, layer) => poly([[a, b], [c, b], [c, d], [a, d]], color, layer);
  const disc = (u, v, r, color, layer, n = 12, sy = 1) => poly(Array.from({ length: n }, (_, i) => [u + Math.cos((i / n) * Math.PI * 2) * r, v + Math.sin((i / n) * Math.PI * 2) * r * sy]), color, layer);
  const h = v1 - v0;
  const V = (k) => v0 + h * k; // up the mural, 0..1
  // The frame of it: the sky, the far trees, the bank, the river.
  rect(u0, V(0.82), u1, V(1), [0.62, 0.8, 0.92], 0);
  rect(u0, V(0.66), u1, V(0.84), [0.3, 0.55, 0.25], 0);
  for (let i = 0; i < 16; i++) disc(u0 + 0.35 + i * (u1 - u0 - 0.7) / 15, V(0.83) + ((i * 37) % 7) * 0.012, 0.28 + ((i * 13) % 4) * 0.05, [0.22 + ((i * 3) % 4) * 0.03, 0.45 + ((i * 5) % 3) * 0.04, 0.2], 1, 9, 0.8);
  rect(u0, V(0.55), u1, V(0.68), [0.55, 0.72, 0.36], 1);
  rect(u0, V(0), u1, V(0.56), [0.3, 0.55, 0.58], 1);
  // The water's ripples.
  for (let i = 0; i < 26; i++) {
    const u = u0 + 0.2 + ((i * 53) % 101) / 100 * (u1 - u0 - 0.6);
    const v = V(0.05 + ((i * 31) % 45) / 100);
    rect(u, v, u + 0.35, v + 0.018, [0.86, 0.94, 0.95], 2);
  }
  // The crowd along the bank: shirts and dresses, heads, a parasol or two.
  const shirts = [[0.9, 0.2, 0.2], [0.95, 0.85, 0.2], [0.2, 0.45, 0.85], [0.95, 0.95, 0.95], [0.85, 0.4, 0.7], [0.3, 0.7, 0.4], [0.95, 0.55, 0.15]];
  const skins = [[0.95, 0.8, 0.68], [0.85, 0.65, 0.5], [0.6, 0.42, 0.3], [0.4, 0.27, 0.18]];
  for (let i = 0; i < 30; i++) {
    const u = u0 + 0.3 + i * (u1 - u0 - 0.6) / 29 + (((i * 17) % 5) - 2) * 0.03;
    if (u > u1 - 2.4) continue; // the faces are there
    const base = V(0.57) + ((i * 11) % 3) * 0.02;
    const tall = 0.2 + ((i * 7) % 3) * 0.03;
    rect(u - 0.05, base, u + 0.05, base + tall, shirts[i % shirts.length], 3);
    disc(u, base + tall + 0.045, 0.045, skins[(i * 3) % skins.length], 3, 8);
    if (i % 9 === 4) {
      rect(u + 0.07, base, u + 0.085, base + tall + 0.25, [0.4, 0.3, 0.2], 3);
      poly([[u - 0.12, base + tall + 0.25], [u + 0.28, base + tall + 0.25], [u + 0.08, base + tall + 0.38]], shirts[(i + 2) % shirts.length], 4);
    }
  }
  // A dog on the bank, tail up.
  const dog = u0 + 2.6;
  rect(dog - 0.16, V(0.58), dog + 0.12, V(0.58) + 0.1, [0.85, 0.62, 0.3], 4);
  disc(dog + 0.16, V(0.58) + 0.13, 0.06, [0.85, 0.62, 0.3], 4, 8);
  for (const x of [-0.13, -0.05, 0.03, 0.09]) rect(dog + x, V(0.58) - 0.06, dog + x + 0.025, V(0.58), [0.7, 0.5, 0.25], 4);
  rect(dog - 0.2, V(0.58) + 0.08, dog - 0.16, V(0.58) + 0.18, [0.85, 0.62, 0.3], 4);
  // Boats on the river: a quad and a pair, oars out.
  const boat = (u, v, len, crew, kit) => {
    poly([[u, v], [u + len, v + 0.01], [u + len * 0.98, v - 0.03], [u + 0.04, v - 0.04]], [0.95, 0.95, 0.92], 3);
    for (let k = 0; k < crew; k++) {
      const x = u + len * (0.2 + 0.6 * (crew > 1 ? k / (crew - 1) : 0.5));
      rect(x - 0.035, v, x + 0.035, v + 0.11, kit, 4);
      disc(x, v + 0.14, 0.032, skins[k % skins.length], 4, 8);
      poly([[x - 0.02, v + 0.06], [x + 0.32, v - 0.12], [x + 0.34, v - 0.1], [x, v + 0.08]], [0.9, 0.9, 0.85], 5);
      rect(x + 0.3, v - 0.16, x + 0.4, v - 0.1, [0.85, 0.15, 0.15], 5);
    }
  };
  boat(u0 + 3.2, V(0.42), 1.6, 4, [0.2, 0.3, 0.75]);
  boat(u0 + 5.6, V(0.22), 0.9, 2, [0.75, 0.15, 0.2]);
  // On the left, a sculler big as life, pulling: blue top, ginger hair.
  const su = u0 + 1.1;
  const sv = V(0.18);
  rect(su - 0.28, sv, su + 0.28, sv + 0.6, [0.2, 0.4, 0.85], 5);
  disc(su, sv + 0.78, 0.2, [0.95, 0.78, 0.65], 5, 14);
  poly([[su - 0.22, sv + 0.82], [su + 0.22, sv + 0.82], [su + 0.18, sv + 1.0], [su - 0.2, sv + 0.98]], [0.75, 0.35, 0.15], 6);
  rect(su - 0.75, sv + 0.3, su + 0.75, sv + 0.36, [0.95, 0.85, 0.7], 6); // arms on the handles
  rect(su - 1.0, sv + 0.28, su + 1.0, sv + 0.32, [0.9, 0.9, 0.86], 5); // the oars
  poly([[su - 0.3, sv], [su + 0.3, sv], [su + 0.5, sv - 0.12], [su - 0.5, sv - 0.12]], [0.95, 0.95, 0.92], 5);
  // On the right, the two big faces: a ginger lad grinning, and a man in a white vest beside him.
  const fu = u1 - 1.5;
  disc(fu, V(0.62), 0.55, [0.97, 0.82, 0.7], 6, 18);
  poly([[fu - 0.55, V(0.7)], [fu - 0.3, V(0.95)], [fu + 0.1, V(1)], [fu + 0.45, V(0.92)], [fu + 0.58, V(0.72)], [fu + 0.2, V(0.86)], [fu - 0.2, V(0.84)]], [0.85, 0.42, 0.15], 7);
  for (const d of [-1, 1]) {
    disc(fu + d * 0.2, V(0.66), 0.07, [1, 1, 1], 7, 10);
    disc(fu + d * 0.2, V(0.66), 0.035, [0.25, 0.45, 0.7], 8, 8);
    disc(fu + d * 0.36, V(0.55), 0.08, [0.95, 0.65, 0.6], 7, 10, 0.7); // rosy cheeks
  }
  poly([[fu - 0.22, V(0.48)], [fu + 0.22, V(0.48)], [fu + 0.12, V(0.41)], [fu - 0.12, V(0.41)]], [0.65, 0.2, 0.2], 7); // the grin
  rect(fu - 0.18, V(0.465), fu + 0.18, V(0.48), [1, 1, 1], 8);
  const mu = u1 - 0.45;
  rect(mu - 0.45, V(0), mu + 0.4, V(0.5), [0.97, 0.97, 0.97], 6); // the vest
  disc(mu, V(0.68), 0.38, [0.92, 0.74, 0.6], 6, 16);
  poly([[mu - 0.38, V(0.74)], [mu - 0.2, V(0.92)], [mu + 0.25, V(0.9)], [mu + 0.38, V(0.72)], [mu, V(0.82)]], [0.45, 0.3, 0.18], 7);
  for (const d of [-1, 1]) disc(mu + d * 0.13, V(0.7), 0.035, [0.2, 0.15, 0.1], 7, 8);
  rect(mu - 0.12, V(0.56), mu + 0.12, V(0.58), [0.6, 0.25, 0.22], 7);
}

// Legs for your paddler standing in the changing room (the paddler mesh, made
// for sitting in a kayak, stops at the hips): dark shorts, bare calves, shoes.
// Hips at y 0, the floor at -HIPS, facing -z like the paddler.
export function legsMesh(skin, shorts = [0.12, 0.13, 0.16], shoes = [0.9, 0.9, 0.88]) {
  const m = new MeshBuilder();
  const ring = (x, y, w, d) => [[x - w, y, -d], [x + w, y, -d], [x + w, y, d], [x - w, y, d]];
  for (const x of [-0.085, 0.085]) {
    m.prism(ring(x, -0.38, 0.075, 0.08), ring(x, 0.1, 0.09, 0.11), shorts);
    m.prism(ring(x, -HIPS + 0.07, 0.045, 0.05), ring(x, -0.38, 0.06, 0.065), skin);
    m.box([x - 0.055, -HIPS, -0.16], [x + 0.055, -HIPS + 0.08, 0.06], shoes);
  }
  return m.build();
}

// The swan on Caversham Bridge, a little confused. It sits in the middle of
// its stretch of parapet facing you, gets up, turns one way or the other (a
// fresh coin toss each time round), waddles that way, looks about, turns
// round, waddles back, half turns as if unsure, faces you again and sits down.
// `t` in seconds; `side` is the turn (1 or -1) that faces it towards you from
// facing up its stretch; `seed` varies the coin tosses between visits. Returns
// where it is along its stretch (0..1), which way it faces (radians from up the
// stretch), how far it has stood (0..1), a turn of the head and the waddle.
export const SWAN_LOOP = 16;
export function confusedSwan(t, side = 1, seed = 0) {
  const n = Math.floor(t / SWAN_LOOP);
  const u = t - n * SWAN_LOOP;
  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const span = (a, b) => ease((u - a) / (b - a));
  const coin = (k) => (Math.abs(Math.sin((k + seed) * 12.9898) * 43758.5453) % 1 < 0.5 ? 1 : -1);
  const dir = coin(n);
  const stand = u < 4 ? 0 : u < 4.8 ? span(4, 4.8) : u < 13.6 ? 1 : 1 - span(13.6, 14.4);
  // Out from the middle towards the end it chose, and back.
  let along = 0.5;
  if (u >= 5) along = 0.5 + dir * 0.4 * span(5, 8);
  if (u >= 10.4) along = 0.5 + dir * 0.4 * (1 - span(10.4, 12.6));
  // Facing: you while sitting; the way it goes; round; half back, unsure; you again.
  const you = (side * Math.PI) / 2;
  const out = dir > 0 ? 0 : Math.PI;
  const back = out + Math.PI;
  const toward = (from, to) => from + (((to - from + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  let face = you;
  if (u >= 2.8) face = you + (toward(you, out) - you) * span(2.8, 4);
  if (u >= 9) face = out + Math.PI * span(9, 10.2) * (dir > 0 ? 1 : -1);
  if (u >= 12.8) face = back - (Math.PI / 3) * Math.sin(Math.PI * span(12.8, 13.6)) * (dir > 0 ? 1 : -1);
  if (u >= 14.6) face = back + (toward(back, you) - back) * span(14.6, 15.8);
  const walking = (u > 5 && u < 8) || (u > 10.4 && u < 12.6);
  const look = u > 8.1 && u < 9 ? Math.sin((u - 8.1) * 14) * 0.5 : 0;
  return { along, face, stand, look, dir, waddle: walking ? Math.sin(u * 12) : 0 };
}

// A swan to look at close up (the river's swans are a few boxes, fine at a
// distance): a rounded body rising to the tail, an S-curved neck, a head with
// an orange beak and black knob. Facing -z, sitting on y 0.
export function bridgeSwanMesh() {
  const m = new MeshBuilder();
  const white = [0.97, 0.97, 0.95];
  const shade = [0.9, 0.9, 0.88];
  const seg = 8;
  // Rings of the body along z: [z, half width, bottom, top].
  const body = [[-0.42, 0.06, 0.12, 0.2], [-0.34, 0.16, 0.05, 0.27], [-0.18, 0.24, 0.02, 0.33], [0.02, 0.27, 0.02, 0.35], [0.22, 0.25, 0.04, 0.35], [0.38, 0.17, 0.09, 0.36], [0.5, 0.04, 0.24, 0.4]];
  const ring = ([z, w, lo, hi], k) => {
    const a = (k / seg) * Math.PI * 2;
    const mid = (lo + hi) / 2;
    return [Math.cos(a) * w, mid + Math.sin(a) * (hi - lo) / 2, z];
  };
  const centre = [0, 0.2, 0.03];
  for (let r = 0; r < body.length - 1; r++) {
    for (let k = 0; k < seg; k++) {
      const [a, b, c, d] = [ring(body[r], k), ring(body[r], k + 1), ring(body[r + 1], k + 1), ring(body[r + 1], k)];
      const out = [0, 1, 2].map((i) => (a[i] + c[i]) / 2 - centre[i]);
      const col = k > seg / 2 ? shade : white;
      m.triFacing(a, b, c, col, out);
      m.triFacing(a, c, d, col, out);
    }
  }
  // The neck: a tube up an S curve from the breast to the head.
  const neck = [[0, 0.26, -0.36], [0, 0.42, -0.42], [0, 0.58, -0.38], [0, 0.72, -0.3], [0, 0.82, -0.3], [0, 0.88, -0.36]];
  const radius = [0.065, 0.055, 0.048, 0.045, 0.045, 0.048];
  const sides = 6;
  const around = (i, k) => {
    const [x, y, z] = neck[i];
    const a = (k / sides) * Math.PI * 2;
    return [x + Math.cos(a) * radius[i], y, z + Math.sin(a) * radius[i]];
  };
  for (let i = 0; i < neck.length - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const [a, b, c, d] = [around(i, k), around(i, k + 1), around(i + 1, k + 1), around(i + 1, k)];
      const out = [Math.cos(((k + 0.5) / sides) * Math.PI * 2), 0, Math.sin(((k + 0.5) / sides) * Math.PI * 2)];
      m.triFacing(a, b, c, white, out);
      m.triFacing(a, c, d, white, out);
    }
  }
  // Head, beak and the black knob.
  m.sphere([0, 0.9, -0.4], 0.07, white, 4, 7);
  m.prism([[-0.035, 0.87, -0.45], [0.035, 0.87, -0.45], [0.035, 0.92, -0.45], [-0.035, 0.92, -0.45]],
    [[-0.012, 0.865, -0.58], [0.012, 0.865, -0.58], [0.012, 0.885, -0.58], [-0.012, 0.885, -0.58]], [0.95, 0.45, 0.1]);
  m.box([-0.03, 0.9, -0.47], [0.03, 0.94, -0.44], [0.08, 0.08, 0.08]);
  m.box([-0.072, 0.9, -0.43], [0.072, 0.915, -0.41], [0.08, 0.08, 0.08]); // eyes
  return m.build();
}

// The swan's legs, for standing: dark grey, under its body, `SWAN_LEGS` tall.
export const SWAN_LEGS = 0.26;
export const SWAN_SIZE = 1.1; // the bridge swan, a touch larger than life
export function swanLegsMesh() {
  const m = new MeshBuilder();
  const leg = [0.12, 0.12, 0.13];
  for (const x of [-0.08, 0.08]) {
    m.box([x - 0.025, -SWAN_LEGS, -0.02], [x + 0.025, 0.02, 0.02], leg);
    m.box([x - 0.06, -SWAN_LEGS, -0.12], [x + 0.06, -SWAN_LEGS + 0.02, 0.03], leg);
  }
  return m.build();
}
