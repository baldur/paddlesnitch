// Roads and paved areas (OpenStreetMap, ODbL), laid on the ground the game
// draws. Shared by the game (world.js near the river, surroundings.js beyond)
// and course:surroundings, which lays some offline: the same code, so a road
// sits where the ground was measured to be. Pure, no DOM; tested in
// tests/kayak-roads.test.js.
//
// A road is { look, width, bridge, line: [[x, z], ...] } (look 0 tarmac,
// 1 paving, 2 a path, 3 gravel: apps/web/scripts/courses/lib/roads.ts LOOK).
// Laid, it's a list of cross-sections { x, z, yl, yr }: its middle, and the
// ground's height under its left and right edges (left = the left of its
// direction), with points added wherever the ground bends under it, so the
// strip between two follows it. Then drawn as quads `LIFT[look]` above that.

/** Tarmac, paving, a path, gravel: greys and buffs in the game's palette, light enough to read from the drone. */
export const ROAD_COLOURS = [[0.32, 0.32, 0.33], [0.6, 0.59, 0.56], [0.64, 0.6, 0.5], [0.58, 0.53, 0.43]];
/** How high each look is drawn over the ground (metres): paving and paths over tarmac where they cross it, all clear of the ground's depth. */
export const LIFT = [0.1, 0.13, 0.12, 0.1];
/** A paved area (a car park) under the roads that cross it. */
export const AREA_LIFT = 0.08;
/** A bridge's deck: its sides go down this far below it. */
export const DECK_DEPTH = 0.6;
const SIDE = [0.5, 0.49, 0.46];

/**
 * The numbers in a roads file back to roads and areas: per road [look, width
 * in decimetres, bridge 0/1, then x, z in decimetres from (x0, z0), each after
 * the first the step from the one before]; per area [look, ring the same way].
 */
export function decodeRoads({ roads = [], areas = [] }, [x0, z0] = [0, 0]) {
  const points = (v, from) => {
    const out = [];
    let [x, z] = [0, 0];
    for (let k = from; k + 1 < v.length; k += 2) {
      x += v[k];
      z += v[k + 1];
      out.push([x0 + x / 10, z0 + z / 10]);
    }
    return out;
  };
  return {
    roads: roads.map((r) => ({ look: r[0], width: r[1] / 10, bridge: r[2] === 1, line: points(r, 3) })),
    areas: areas.map((a) => ({ look: a[0], ring: points(a, 1) })),
  };
}

// Across the line at point i: the unit normal to its left, scaled so the edge
// stays `half` from both segments at a bend (a mitre, at most 2 × half).
function across(line, i) {
  const n = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  };
  const before = i > 0 ? n(line[i - 1], line[i]) : null;
  const after = i < line.length - 1 ? n(line[i], line[i + 1]) : null;
  if (!before) return after;
  if (!after) return before;
  const m = [before[0] + after[0], before[1] + after[1]];
  const len = Math.hypot(...m);
  if (len < 1e-6) return after;
  const k = 1 / Math.max(0.5, (m[0] * after[0] + m[1] * after[1]) / len);
  return [(m[0] / len) * k, (m[1] / len) * k];
}

/** The left and right edge points of a road `width` wide at point i of its line. */
export function edges(line, i, width) {
  const [nx, nz] = across(line, i);
  const [x, z] = line[i];
  const h = width / 2;
  return [[x + nx * h, z + nz * h], [x - nx * h, z - nz * h]];
}

/**
 * A road laid on the ground: `height(x, z)` is the drawn ground there (null
 * where there's none). Each segment is split until the ground under its middle
 * runs within `tol` of straight between its ends (looked at a quarter, half and
 * three quarters along; not below `min` metres; at most `max` long), so the
 * strip doesn't cut into a rise or hang over a dip. An edge's height is the
 * ground's under it, both raised where the middle stands higher (a cambered or
 * ridged road). A bridge is laid straight from end to end (its deck), never
 * under the ground. Sections where there's no ground are null.
 */
export function layRoad({ line, width, bridge }, height, { tol = 0.04, min = 1, max = 24 } = {}) {
  const pts = [line[0]];
  const split = (a, b, depth) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > min * 2 && depth < 12) {
      let bend = len > max;
      const [ya, yb] = [height(...a), height(...b)];
      for (const t of [0.25, 0.5, 0.75]) {
        if (bend) break;
        const y = height(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        // (Where the ground starts or stops under it, split to find where.)
        if (y === null || ya === null || yb === null) bend = !(y === null && ya === null && yb === null);
        else bend = Math.abs(y - (ya + (yb - ya) * t)) > tol;
      }
      if (bend) {
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        split(a, mid, depth + 1);
        split(mid, b, depth + 1);
        return;
      }
    }
    pts.push(b);
  };
  for (let i = 1; i < line.length; i++) split(line[i - 1], line[i], 0);
  let deck = null;
  if (bridge) {
    // Straight from the ground at one end to the ground at the other.
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const [y0, y1] = [height(...pts[0]) ?? 0, height(...pts.at(-1)) ?? 0];
    const total = along.at(-1) || 1;
    deck = along.map((d) => y0 + ((y1 - y0) * d) / total);
  }
  const sections = pts.map(([x, z], i) => {
    const [l, r] = edges(pts, i, width);
    const [yl, yr, yc] = [height(...l), height(...r), height(x, z)];
    if (yl === null || yr === null || yc === null) return null;
    let [a, b] = [yl, yr];
    const up = yc - (a + b) / 2;
    if (up > 0) [a, b] = [a + up, b + up];
    if (deck) { const d = Math.max(deck[i], a, b); [a, b] = [Math.max(a, d), Math.max(b, d)]; }
    return { x, z, yl: a, yr: b, l, r };
  });
  // Where the ground still stands over a strip between two sections (a crease
  // across it at a slant), both ends go up by as much, so it never cuts in.
  const rise = sections.map((s, i) => {
    const t = sections[i + 1];
    if (!s || !t) return 0;
    let most = 0;
    // (The strip's height as its two triangles have it, split from this
    // section's left to the next one's right: roadQuads.)
    const drawn = (g, f) => (g >= f ? s.yl + (s.yr - s.yl) * g + (t.yr - s.yr) * f : s.yl + (t.yr - t.yl) * g + (t.yl - s.yl) * f);
    for (const f of [0.25, 0.5, 0.75]) for (const g of [0, 0.25, 0.5, 0.75, 1]) {
      const [x, z] = [0, 1].map((k) => (s.l[k] + (s.r[k] - s.l[k]) * g) * (1 - f) + (t.l[k] + (t.r[k] - t.l[k]) * g) * f);
      const y = height(x, z);
      if (y !== null) most = Math.max(most, y - drawn(g, f));
    }
    return most;
  });
  return sections.map((s, i) => {
    if (!s) return null;
    const up = Math.max(rise[i], i > 0 ? rise[i - 1] : 0);
    return { x: s.x, z: s.z, yl: s.yl + up, yr: s.yr + up };
  });
}

/**
 * A laid road as quads `lift` over its sections (`look`'s colour), skipping
 * where a section has no ground; a bridge's deck gets sides down DECK_DEPTH.
 */
export function roadQuads(m, sections, { look, width, bridge }, lift = LIFT[look]) {
  const colour = ROAD_COLOURS[look];
  // (Edges from the runs between gaps, so a gap's ends are square.)
  let run = [];
  const flush = () => {
    const pts = run.map((s) => [s.x, s.z]);
    for (let i = 1; i < run.length; i++) {
      const [l0, r0] = edges(pts, i - 1, width);
      const [l1, r1] = edges(pts, i, width);
      const [a, b] = [run[i - 1], run[i]];
      const L0 = [l0[0], a.yl + lift, l0[1]];
      const R0 = [r0[0], a.yr + lift, r0[1]];
      const L1 = [l1[0], b.yl + lift, l1[1]];
      const R1 = [r1[0], b.yr + lift, r1[1]];
      m.quad(L0, R0, R1, L1, colour);
      if (bridge) {
        for (const [p, q] of [[L0, L1], [R0, R1]]) m.quad(p, q, [q[0], q[1] - DECK_DEPTH, q[2]], [p[0], p[1] - DECK_DEPTH, p[2]], SIDE);
      }
    }
    run = [];
  };
  for (let i = 0; i < sections.length; i++) {
    if (!sections[i]) { flush(); continue; }
    run.push(sections[i]);
  }
  flush();
}

/** A road laid on `height` and drawn into `m` (layRoad then roadQuads). */
export function drawRoad(m, road, height, opts) {
  roadQuads(m, layRoad(road, height, opts), road, opts?.lift);
}

/**
 * A ring ([[x, z]]) as triangles (ear clipping; either winding). A ring that
 * crosses itself is cut as far as it goes.
 */
export function triangulate(ring) {
  const pts = ring.slice();
  if (pts.length > 3 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const [p, q] = [pts[i], pts[(i + 1) % pts.length]]; area += p[0] * q[1] - q[0] * p[1]; }
  const sign = Math.sign(area) || 1;
  const cross = (a, b, c) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * sign;
  const idx = pts.map((_, i) => i);
  const out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const [a, b, c] = [pts[idx[(k + idx.length - 1) % idx.length]], pts[idx[k]], pts[idx[(k + 1) % idx.length]]];
      if (cross(a, b, c) <= 1e-9) continue;
      const blocked = idx.some((j) => {
        const p = pts[j];
        if (p === a || p === b || p === c) return false;
        return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
      });
      if (blocked) continue;
      out.push([a, b, c]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx.map((i) => pts[i]));
  return out;
}

/**
 * A paved area laid on the ground as triangles [[x, y, z] × 3] (y the ground's,
 * no lift): its ring triangulated, each triangle split in four until it's under
 * `max` metres across and the ground under seven points of it (its edges'
 * middles, its middle, and half way from each corner to it) is within `tol` of
 * its plane, at most down to `min` metres. A triangle is then raised by as much
 * as the ground at those points stands over it, so it never cuts into a rise.
 * Triangles with no ground under a corner are left out.
 */
export function layArea(ring, height, { tol = 0.05, max = 16, min = 1.5 } = {}) {
  const out = [];
  const at = ([x, z]) => { const y = height(x, z); return y === null ? null : [x, y, z]; };
  const split = (a, b, c, depth) => {
    const ya = [a, b, c].map(at);
    if (ya.includes(null) && depth >= 4) return;
    const big = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const [ab, bc, ca] = [mid(a, b), mid(b, c), mid(c, a)];
    // Seven points in it, by their weights on its corners.
    const W = [[0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [1 / 3, 1 / 3, 1 / 3], [2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3]];
    let rise = 0;
    let bend = big > max || ya.includes(null);
    if (!ya.includes(null)) {
      for (const w of W) {
        const y = height(w[0] * a[0] + w[1] * b[0] + w[2] * c[0], w[0] * a[1] + w[1] * b[1] + w[2] * c[1]);
        if (y === null) { bend = true; continue; }
        const d = y - (w[0] * ya[0][1] + w[1] * ya[1][1] + w[2] * ya[2][1]);
        if (Math.abs(d) > tol) bend = true;
        rise = Math.max(rise, d);
      }
    }
    if (bend && big > min && depth < 8) {
      split(a, ab, ca, depth + 1);
      split(ab, b, bc, depth + 1);
      split(ca, bc, c, depth + 1);
      split(ab, bc, ca, depth + 1);
      return;
    }
    if (!ya.includes(null)) out.push(ya.map(([x, y, z]) => [x, y + rise, z]));
  };
  for (const [a, b, c] of triangulate(ring)) split(a, b, c, 0);
  return out;
}

/** Laid area triangles drawn `lift` over the ground. */
export function areaTris(m, tris, look, lift = AREA_LIFT) {
  const colour = ROAD_COLOURS[look];
  for (const [a, b, c] of tris) m.tri([a[0], a[1] + lift, a[2]], [b[0], b[1] + lift, b[2]], [c[0], c[1] + lift, c[2]], colour);
}

/**
 * The drawn ground as a height lookup: the triangles of `vertices` (x, y, z
 * first of every `stride` numbers) from vertex `from` to `to`, binned every
 * `cell` metres where `wanted(i, j)` (only where roads are, so it's cheap). At
 * a point, the highest triangle over it, or null.
 */
export function groundOf(vertices, from, to, wanted, { stride = 9, cell = 8 } = {}) {
  const bins = new Map();
  const key = (i, j) => (i + 32768) * 65536 + (j + 32768);
  for (let v = from; v + 2 < to; v += 3) {
    const [a, b, c] = [v * stride, (v + 1) * stride, (v + 2) * stride];
    const x0 = Math.min(vertices[a], vertices[b], vertices[c]);
    const x1 = Math.max(vertices[a], vertices[b], vertices[c]);
    const z0 = Math.min(vertices[a + 2], vertices[b + 2], vertices[c + 2]);
    const z1 = Math.max(vertices[a + 2], vertices[b + 2], vertices[c + 2]);
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) {
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        if (!wanted(i, j)) continue;
        const k = key(i, j);
        let list = bins.get(k);
        if (!list) bins.set(k, (list = []));
        list.push(a, b, c);
      }
    }
  }
  return (x, z) => {
    const list = bins.get(key(Math.floor(x / cell), Math.floor(z / cell)));
    if (!list) return null;
    let best = null;
    for (let n = 0; n < list.length; n += 3) {
      const [a, b, c] = [list[n], list[n + 1], list[n + 2]];
      const [ax, az, bx, bz, cx, cz] = [vertices[a], vertices[a + 2], vertices[b], vertices[b + 2], vertices[c], vertices[c + 2]];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const w = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (u < -1e-6 || w < -1e-6 || u + w > 1 + 1e-6) continue;
      const y = u * vertices[a + 1] + w * vertices[b + 1] + (1 - u - w) * vertices[c + 1];
      if (best === null || y > best) best = y;
    }
    return best;
  };
}

/** The cells (every `cell` metres) under the roads and areas, as wanted(i, j) for groundOf. */
export function cellsUnder(roads, areas, cell = 8) {
  const set = new Set();
  const mark = (x, z, r) => {
    for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) for (let j = Math.floor((z - r) / cell); j <= Math.floor((z + r) / cell); j++) set.add(`${i},${j}`);
  };
  for (const { line, width } of roads) {
    for (let k = 1; k < line.length; k++) {
      const [a, b] = [line[k - 1], line[k]];
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell / 2));
      for (let t = 0; t <= n; t++) mark(a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n, width + 1);
    }
  }
  for (const { ring } of areas) {
    const xs = ring.map((p) => p[0]);
    const zs = ring.map((p) => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs) + cell; x += cell) for (let z = Math.min(...zs); z <= Math.max(...zs) + cell; z += cell) mark(x, z, 1);
  }
  return (i, j) => set.has(`${i},${j}`);
}

/**
 * Whether (x, z) is on a road or a paved area, or within `clear` of a road's
 * edge: what keeps trees off them. Binned every 20 m.
 */
export function onRoads(roads, areas = []) {
  const bins = new Map();
  const add = (x0, z0, x1, z1, item) => {
    for (let i = Math.floor(x0 / 20); i <= Math.floor(x1 / 20); i++) for (let j = Math.floor(z0 / 20); j <= Math.floor(z1 / 20); j++) {
      const k = `${i},${j}`;
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(item);
    }
  };
  const PAD = 10; // (the most `clear` asked for, binned with it)
  for (const { line, width } of roads) for (let k = 1; k < line.length; k++) {
    const [a, b] = [line[k - 1], line[k]];
    const r = width / 2 + PAD;
    add(Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, { a, b, half: width / 2 });
  }
  for (const { ring } of areas) add(Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1])), Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1])), { ring });
  return (x, z, clear = 0) => (bins.get(`${Math.floor(x / 20)},${Math.floor(z / 20)}`) ?? []).some((it) => (it.ring ? insideRing(it.ring, x, z) : toSegment(x, z, it.a, it.b) < it.half + clear));
}

function toSegment(x, z, a, b) {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}
function insideRing(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
