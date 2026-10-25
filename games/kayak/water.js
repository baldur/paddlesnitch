// The mapped water of a real river (a course file's `water`: the rings of the
// river's areas and its islands): whether a point is on it, and the way back to
// it from the land. world.js shapes the land with it; race.js keeps boats on
// it, islands and moored boats included, so a boat meets the real bank and not
// an edge worked out from the racing line. Pure, no DOM.

export const SHORE_SEARCH = 60; // metres: further from the river line than this, the line's distance will do

// The rings as segments: whether a point is in them (an odd number of
// crossings), and how far the nearest shore is (up to SHORE_SEARCH), and
// where.
export function waterMap(rings) {
  const bands = new Map(); // 10 m bands of z: the segments spanning each, for crossings
  const cells = new Map(); // 20 m squares: the segments in each, for distances
  const add = (map, k, seg) => map.set(k, [...(map.get(k) ?? []), seg]);
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const seg = [ring[i], ring[i + 1]];
      const [[ax, az], [bx, bz]] = seg;
      for (let b = Math.floor(Math.min(az, bz) / 10); b <= Math.floor(Math.max(az, bz) / 10); b++) add(bands, b, seg);
      const len = Math.hypot(bx - ax, bz - az);
      const seen = new Set();
      for (let t = 0; t <= len; t += 10) {
        const f = len ? t / len : 0;
        const k = `${Math.floor((ax + (bx - ax) * f) / 20)},${Math.floor((az + (bz - az) * f) / 20)}`;
        if (!seen.has(k)) add(cells, k, seg);
        seen.add(k);
      }
      const k = `${Math.floor(bx / 20)},${Math.floor(bz / 20)}`;
      if (!seen.has(k)) add(cells, k, seg);
    }
  }
  // The nearest point on any shore within `reach`: { x, z, d }, or null.
  const nearest = (x, z, reach = SHORE_SEARCH) => {
    let best = null;
    const r = Math.ceil(reach / 20);
    const [cx, cz] = [Math.floor(x / 20), Math.floor(z / 20)];
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cz - r; j <= cz + r; j++) {
        for (const [[ax, az], [bx, bz]] of cells.get(`${i},${j}`) ?? []) {
          const dx = bx - ax;
          const dz = bz - az;
          const f = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          const px = ax + dx * f;
          const pz = az + dz * f;
          const d = Math.hypot(x - px, z - pz);
          if (d <= reach && (!best || d < best.d)) best = { x: px, z: pz, d };
        }
      }
    }
    return best;
  };
  return {
    rings: rings.length,
    inside(x, z) {
      let odd = false;
      for (const [[ax, az], [bx, bz]] of bands.get(Math.floor(z / 10)) ?? []) {
        if ((az > z) !== (bz > z) && x < ax + ((z - az) * (bx - ax)) / (bz - az)) odd = !odd;
      }
      return odd;
    },
    shore: (x, z) => nearest(x, z)?.d ?? SHORE_SEARCH,
    nearest,
  };
}

// Where a boat can't go on a real river: off the mapped water, or into a
// moored boat (`boxes`: { x, z, ux, uz, half, beam }, ux/uz along its length).
// dry(x, z) says whether a point is; out(x, z) is the way back onto open water
// from one that is: { x, z } the nearest point that isn't, and (nx, nz) the
// direction to it.
export function shoreOf(water, boxes = []) {
  const inBox = (b, x, z) => {
    const dx = x - b.x;
    const dz = z - b.z;
    return Math.abs(dx * b.ux + dz * b.uz) < b.half && Math.abs(-dx * b.uz + dz * b.ux) < b.beam / 2;
  };
  const near = (x, z) => boxes.filter((b) => Math.abs(x - b.x) < b.half + b.beam && Math.abs(z - b.z) < b.half + b.beam);
  return {
    dry: (x, z) => !water.inside(x, z) || near(x, z).some((b) => inBox(b, x, z)),
    out(x, z) {
      // Out of a moored boat: across it, to the nearer side.
      const box = near(x, z).find((b) => inBox(b, x, z));
      if (box) {
        const dx = x - box.x;
        const dz = z - box.z;
        const across = -dx * box.uz + dz * box.ux;
        const side = across >= 0 ? 1 : -1;
        const push = box.beam / 2 - Math.abs(across);
        return { x: x - box.uz * side * push, z: z + box.ux * side * push, nx: -box.uz * side, nz: box.ux * side };
      }
      const p = water.nearest(x, z, 25);
      if (!p) return null;
      const d = p.d || 1;
      return { x: p.x, z: p.z, nx: (p.x - x) / d, nz: (p.z - z) / d };
    },
  };
}
