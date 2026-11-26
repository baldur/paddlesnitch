// The land round the Reading Thames out to 1 km: ground, buildings and trees
// past the game's own land (world.js realLand stops 320 m from the water),
// which only the drone sees. Its numbers are in surroundings/ (one file per
// 500 m block, made by `pnpm --filter web course:surroundings build` from
// Environment Agency lidar, OGL v3, and OpenStreetMap's buildings, ODbL), and
// nothing of it loads until the drone takes off: the boat's game is as it was.
//
// Blocks are fetched nearest first as the camera comes within LOAD of them,
// each built into one mesh (its ground, buildings and trees merged), in full
// within NEAR and with less detail further off, and drawn when in view.
import { MeshBuilder } from './meshes.js';
import { PALETTE } from './world.js';

export const NEAR = 700; // metres to a block: nearer, drawn in full
export const LOAD = 1800; // fetched within this
export const DRAW = 2400; // drawn within this (the haze has nearly all of it by then)
const KINDS = ['house', 'flats', 'boathouse', 'other'];
const CELL = { grass: 0, woods: 1, town: 2, water: 3, none: 4 };

/** A block's file (lib/surroundings.ts blockFile) as numbers in game metres. */
export function decodeBlock(f) {
  const { i, j, cell } = f;
  const x0 = i * 500;
  const z0 = j * 500;
  const n = 500 / cell + 1;
  const dm = Int32Array.from(f.ground.split(','), Number);
  for (let r = 0; r < n; r++) for (let c = 1; c < n; c++) dm[r * n + c] += dm[r * n + c - 1];
  const heights = Float32Array.from(dm, (v) => v / 10);
  const cells = new Uint8Array((n - 1) * (n - 1));
  let k = 0;
  for (const run of f.cells.split(',')) {
    const kind = Number(run[0]);
    cells.fill(kind, k, k + Number(run.slice(1)));
    k += Number(run.slice(1));
  }
  const buildings = f.buildings.map((b) => {
    const ring = [];
    for (let q = 0; q < b.length - 4; q += 2) ring.push([x0 + b[q] / 10, z0 + b[q + 1] / 10]);
    const [ground, base, height, kind] = b.slice(-4);
    return { ring, ground: ground / 10, base: base / 10, height: height / 10, kind: KINDS[kind] };
  });
  const trees = f.trees.map(([x, z, h]) => [x0 + x / 10, z0 + z / 10, h / 10]);
  const ys = [...heights, ...buildings.map((b) => b.ground + b.height + 4), ...trees.map(([x, z, h]) => heightIn({ x0, z0, n, cell, heights }, x, z) + h)];
  return { i, j, x0, z0, n, cell, heights, cells, buildings, trees, low: Math.min(...ys), high: Math.max(...ys) };
}

/** The block's ground at (x, z), straight between its points. */
export function heightIn({ x0, z0, n, cell, heights }, x, z) {
  const u = Math.max(0, Math.min(n - 1.001, (x - x0) / cell));
  const v = Math.max(0, Math.min(n - 1.001, (z - z0) / cell));
  const [c, r] = [Math.floor(u), Math.floor(v)];
  const q = (a, b) => heights[b * n + a];
  return (q(c, r) * (1 - (u - c)) + q(c + 1, r) * (u - c)) * (1 - (v - r)) + (q(c, r + 1) * (1 - (u - c)) + q(c + 1, r + 1) * (u - c)) * (v - r);
}

// The same few draws for a thing wherever it is: a hash of its block and place in it.
function draws(i, j, k) {
  let a = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k + 1, 83492791)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shade = (color, rand, amount) => { const k = 1 + (rand() - 0.5) * 2 * amount; return color.map((c) => Math.min(1, c * k)); };
const GROUND = [PALETTE.grass, PALETTE.shaded, [0.5, 0.5, 0.44], [0.2, 0.26, 0.27]];

/**
 * A block as one mesh: its ground cells (every 10 m, or 20 m where `far`), its
 * buildings (walls and a hipped roof on houses and boathouses, flat on the
 * rest, as world.js draws them; far off, each as its footprint's box) and its
 * trees (a trunk and a crown; far off, a smaller ball of crown alone).
 */
export function blockMesh(b, far = false) {
  const m = new MeshBuilder();
  const { n, cell, x0, z0, heights, cells } = b;
  const at = (c, r) => [x0 + c * cell, heights[r * n + c], z0 + r * cell];
  const kindAt = (c, r) => cells[r * (n - 1) + c];
  const quadAt = (c, r, w, kind) => {
    const rand = draws(b.i, b.j, -1 - r * n - c);
    m.quad(at(c, r), at(c + w, r), at(c + w, r + w), at(c, r + w), shade(GROUND[kind], rand, kind === CELL.water ? 0 : 0.06));
  };
  for (let r = 0; r < n - 1; r += far ? 2 : 1) {
    for (let c = 0; c < n - 1; c += far ? 2 : 1) {
      const kind = kindAt(c, r);
      // Far off, four cells as one where they're all drawn (in the first one's colour).
      if (far && c + 1 < n - 1 && r + 1 < n - 1 && kind !== CELL.none && kindAt(c + 1, r) !== CELL.none && kindAt(c, r + 1) !== CELL.none && kindAt(c + 1, r + 1) !== CELL.none) {
        quadAt(c, r, 2, kind);
        continue;
      }
      for (const [dc, dr] of far ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]]) {
        if (c + dc >= n - 1 || r + dr >= n - 1) continue;
        const k = kindAt(c + dc, r + dr);
        if (k !== CELL.none) quadAt(c + dc, r + dr, 1, k);
      }
    }
  }
  b.buildings.forEach((bd, k) => building(m, bd, draws(b.i, b.j, k), far));
  b.trees.forEach(([x, z, h], k) => {
    const rand = draws(b.i, b.j, 100000 + k);
    const y = heightIn(b, x, z);
    const leaf = shade(PALETTE.leaves[Math.floor(rand() * PALETTE.leaves.length)], rand, 0.1);
    if (far) return m.sphere([x, y + h * 0.6, z], h * 0.36, leaf, 2, 5);
    m.cylinder([x, y - 0.3, z], 0.2 + h * 0.015, h * 0.35, 3, PALETTE.trunk);
    m.sphere([x, y + h * 0.64, z], h * 0.34, leaf, 3, 6);
  });
  return m.build();
}

// A plain building, as world.js's `building` draws one (walls from its lowest
// corner's ground, less a metre, to its height over its middle's; a hipped roof
// on a house or boathouse), with its own draws; no windows (they're drawn only
// within 80 m of the water). Far off, its footprint's box along its longest side.
function building(m, b, rand, far) {
  let ring = b.ring;
  if (far && ring.length > 4) ring = boxAround(ring);
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const [y0, top] = [b.base - 1, b.ground + b.height];
  const wall = shade(PALETTE.walls[Math.floor(rand() * PALETTE.walls.length)], rand, 0.05);
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const out = [(ax + bx) / 2 - cx, 0, (az + bz) / 2 - cz];
    m.triFacing([ax, y0, az], [bx, y0, bz], [bx, top, bz], wall, out);
    m.triFacing([ax, y0, az], [bx, top, bz], [ax, top, az], wall, out);
  }
  const pitched = b.kind === 'house' || b.kind === 'boathouse';
  const roof = pitched ? PALETTE.roofs[Math.floor(rand() * PALETTE.roofs.length)] : PALETTE.coping;
  const peak = [cx, top + (pitched ? roofRise(b.ring) : 0), cz];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    m.tri([ax, top, az], [bx, top, bz], peak, roof);
  }
}

// A pitched roof's rise, as world.js draws it (from the footprint's area).
function roofRise(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const [p, q] = [ring[i], ring[(i + 1) % ring.length]]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.min(4, 1.5 + Math.sqrt(Math.abs(a / 2)) * 0.18);
}

/** The rectangle round a footprint, square to its longest side. */
export function boxAround(ring) {
  let best = 0;
  let dir = [1, 0];
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > best) [best, dir] = [len, [(b[0] - a[0]) / len, (b[1] - a[1]) / len]];
  }
  const across = [-dir[1], dir[0]];
  const us = ring.map(([x, z]) => x * dir[0] + z * dir[1]);
  const vs = ring.map(([x, z]) => x * across[0] + z * across[1]);
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [dir[0] * u + across[0] * v, dir[1] * u + across[1] * v]);
}

/** How far (x, z) is from a block (0 inside it). */
export function toBlock(x, z, i, j) {
  const [x0, z0] = [i * 500, j * 500];
  return Math.hypot(Math.max(x0 - x, 0, x - x0 - 500), Math.max(z0 - z, 0, z - z0 - 500));
}

/** The blocks (index's [i, j]) within `radius` of (x, z), nearest first. */
export function nearest(blocks, x, z, radius) {
  return blocks.map(([i, j]) => ({ i, j, d: toBlock(x, z, i, j) })).filter((b) => b.d <= radius).sort((a, b) => a.d - b.d);
}

/** Whether any of a box ([x0, y0, z0], [x1, y1, z1]) is in view of the camera's matrix (column-major, as main.js's). */
export function inView(m, [x0, y0, z0], [x1, y1, z1]) {
  const outside = [0, 0, 0, 0, 0, 0];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cx < -cw) outside[0]++;
    if (cx > cw) outside[1]++;
    if (cy < -cw) outside[2]++;
    if (cy > cw) outside[3]++;
    if (cz < 0) outside[4]++; // (behind: depth runs 0..w, as in both renderers)
    if (cz > cw) outside[5]++;
  }
  return !outside.includes(8);
}

/**
 * The surroundings, streamed: `update(eye, viewProj)` fetches what's near,
 * builds a block's mesh a frame (in full or not, by how near), lets go of the
 * meshes of blocks gone far, and returns the meshes to draw this frame.
 * `load(path)` fetches a file of surroundings/ as JSON.
 */
export function createSurroundings(renderer, load = (path) => fetch(new URL(`surroundings/${path}`, import.meta.url)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${path}: ${r.status}`))))) {
  let index = null;
  load('index.json').then((v) => { index = v.blocks; }, () => { index = []; });
  const data = new Map(); // "i,j" -> decoded block, or 'loading'
  const meshes = new Map(); // "i,j" -> { mesh, far }
  const stats = { fetched: 0, bytes: 0, triangles: 0 };
  let inFlight = 0;
  return {
    stats,
    update(eye, viewProj) {
      if (!index) return [];
      const [x, z] = [eye[0], eye[2]];
      for (const { i, j } of nearest(index, x, z, LOAD)) {
        const key = `${i},${j}`;
        if (data.has(key) || inFlight >= 3) continue;
        data.set(key, 'loading');
        inFlight++;
        load(`${i}_${j}.json`).then((f) => { data.set(key, decodeBlock(f)); stats.fetched++; }, () => data.delete(key)).finally(() => inFlight--);
      }
      // One block built a frame, the nearest that needs it (a block between
      // NEAR and NEAR + 100 keeps the detail it has, so it doesn't flicker).
      let built = false;
      const list = [];
      // Gone far: let go of its mesh (its numbers are kept, for coming back).
      for (const [key, have] of meshes) {
        const [i, j] = key.split(',').map(Number);
        if (toBlock(x, z, i, j) <= DRAW + 100) continue;
        renderer.destroyMesh?.(have.mesh);
        meshes.delete(key);
        stats.triangles -= have.count;
      }
      for (const { i, j, d } of nearest(index, x, z, DRAW)) {
        const key = `${i},${j}`;
        const b = data.get(key);
        const have = meshes.get(key);
        if (!b || b === 'loading') continue;
        const far = have && d > NEAR && d < NEAR + 100 ? have.far : d >= NEAR;
        if ((!have || have.far !== far) && !built) {
          built = true;
          const geometry = blockMesh(b, far);
          const mesh = renderer.createMesh(geometry);
          renderer.place(mesh, [IDENTITY]);
          if (have) { renderer.destroyMesh?.(have.mesh); stats.triangles -= have.count; }
          meshes.set(key, { mesh, far, count: geometry.count / 3 });
          stats.triangles += geometry.count / 3;
        }
        const now = meshes.get(key);
        if (now && inView(viewProj, [b.x0, b.low, b.z0], [b.x0 + 500, b.high, b.z0 + 500])) list.push(now.mesh);
      }
      return list;
    },
  };
}
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
