// Roofs shaped by the lidar (lidar.js `roofs`): the surface a roof record
// stands for, and its walls and roof as triangles. Shared by the fit
// (fitRoof in apps/web/scripts/courses/lib/lidar.ts, which measures its error
// on this same surface) and the game (world.js), so what is drawn is what was
// measured.
//
// A record is [cx, cz, angle, cuts, ...parts] by the middle of the footprint
// (the mean of its corners, as world.js finds it). `angle` (degrees) turns the
// building's frame: u along (cos, sin) in game x, z, v across (-sin, cos), both
// from (cx, cz). `cuts` are u values splitting the footprint into parts, one
// part a slab between two cuts ([] for a single roof). A part is one of
//   ['flat', r]                 level at r
//   ['shed', q, e, r]           one slope, e at the low side, r at the high
//   ['gable', q, e, r, a]       two slopes up to a ridge along u, a of the way across
//   ['hip', q, e, r, a, b]      a gable with its ends hipped back b metres
// in the part's own frame, q quarter turns from the building's (a shed rises
// along +v). Heights are metres above the ground at (cx, cz): e at the eaves,
// r at the ridge (or the high side). The extents a part's shape is set on are
// those of its share of the footprint in its frame, so they aren't stored.
// A record [cx, cz, reason] says the lidar was too thin ('few'), too noisy
// ('noisy') or a tree over a house ('tall') to fit: drawn as before.

/** The unit vectors of a frame turned `deg` degrees: [ux, uz]. */
export function axis(deg) {
  const t = (deg * Math.PI) / 180;
  return [Math.cos(t), Math.sin(t)];
}

/** A polygon ([[x, z]]) clipped to where nx·x + nz·z <= c (Sutherland–Hodgman). */
export function clipHalf(poly, nx, nz, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const [dp, dq] = [nx * p[0] + nz * p[1] - c, nx * q[0] + nz * q[1] - c];
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** Whether a record is a fitted roof (not a refusal). */
export const fitted = (rec) => Array.isArray(rec?.[3]);

/**
 * A fitted record's parts in game metres: each { region, planes, lo, hi, extent },
 * `region` its share of the footprint, `planes` [A, B, C] (height A + B x + C z,
 * the roof the lowest of them), `lo`/`hi` the slab's u bounds, `extent` the
 * region's [u0, u1, v0, v1] in the part's frame.
 * `unit` gives every part eaves 0 and ridge 1 (the fit's shape alone).
 */
export function roofParts(ring, rec, unit = false) {
  const [cx, cz, angle, cuts, ...parts] = rec;
  const [ux, uz] = axis(angle);
  const u0 = cx * ux + cz * uz;
  return parts.map((part, k) => {
    const lo = k > 0 ? cuts[k - 1] : -Infinity;
    const hi = k < cuts.length ? cuts[k] : Infinity;
    let region = ring;
    if (k > 0) region = clipHalf(region, -ux, -uz, -(lo + u0));
    if (k < cuts.length) region = clipHalf(region, ux, uz, hi + u0);
    const [form, q = 0] = part;
    const [e, r] = unit ? (form === 'flat' ? [1, 1] : [0, 1]) : form === 'flat' ? [part[1], part[1]] : [part[2], part[3]];
    // The part's frame, and its region's extents in it.
    const [pu, pz] = axis(angle + 90 * q);
    const U = (x, z) => (x - cx) * pu + (z - cz) * pz;
    const V = (x, z) => -(x - cx) * pz + (z - cz) * pu;
    const us = region.map(([x, z]) => U(x, z));
    const vs = region.map(([x, z]) => V(x, z));
    const [a0, a1, b0, b1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    // A plane rising from 0 at `at` to 1 at `to` along u (du = 1) or v (du = 0), as [A, B, C] for e..r.
    const rise = (du, at, to) => {
      // t = (coord - at) / (to - at), coord = u or v: linear in x, z.
      const s = 1 / (to - at);
      const [gx, gz, c0] = du ? [pu, pz, -(cx * pu + cz * pz)] : [-pz, pu, cx * pz - cz * pu];
      const t = [(c0 - at) * s, gx * s, gz * s];
      return [e + (r - e) * t[0], (r - e) * t[1], (r - e) * t[2]];
    };
    let planes;
    if (form === 'flat' || region.length < 3 || b1 - b0 < 0.2) planes = [[r, 0, 0]];
    else if (form === 'shed') planes = [rise(0, b0, b1)];
    else {
      const ridge = b0 + (b1 - b0) * part[4];
      planes = [rise(0, b0, ridge), rise(0, b1, ridge)];
      if (form === 'hip' && a1 - a0 > 0.2) {
        const b = Math.min(part[5], (a1 - a0) / 2);
        planes.push(rise(1, a0, a0 + b), rise(1, a1, a1 - b));
      }
    }
    return { region, planes, lo, hi, extent: [a0, a1, b0, b1] };
  });
}

/** Which part (index) a point is in, by its u along the building's frame. */
export function partAt(rec, x, z) {
  const [cx, cz, angle, cuts] = rec;
  const [ux, uz] = axis(angle);
  const u = (x - cx) * ux + (z - cz) * uz;
  let k = 0;
  while (k < cuts.length && u >= cuts[k]) k++;
  return k;
}

const planeAt = ([A, B, C], x, z) => A + B * x + C * z;
/** A part's roof height at a point: the lowest of its planes. */
export const surfaceAt = (planes, x, z) => Math.min(...planes.map((p) => planeAt(p, x, z)));
/** A fitted roof's height (above its ground) at a point inside its footprint. */
export function roofHeight(ring, rec, x, z, parts = roofParts(ring, rec)) {
  return surfaceAt(parts[partAt(rec, x, z)].planes, x, z);
}

const area2 = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [p, q] = [poly[i], poly[(i + 1) % poly.length]];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
};

/** A simple polygon as triangles (ear clipping; a fan of what's left if it can't find an ear). */
export function triangulate(poly) {
  let pts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
  });
  if (pts.length < 3) return [];
  if (area2(pts) < 0) pts = [...pts].reverse();
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const tris = [];
  while (pts.length > 3) {
    let cut = -1;
    for (let i = 0; i < pts.length && cut < 0; i++) {
      const [a, b, c] = [pts[(i + pts.length - 1) % pts.length], pts[i], pts[(i + 1) % pts.length]];
      if (cross(a, b, c) <= 1e-9) continue;
      const blocked = pts.some((p) => p !== a && p !== b && p !== c && cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0);
      if (!blocked) cut = i;
    }
    if (cut < 0) {
      for (let i = 1; i < pts.length - 1; i++) tris.push([pts[0], pts[i], pts[i + 1]]);
      return tris;
    }
    tris.push([pts[(cut + pts.length - 1) % pts.length], pts[cut], pts[(cut + 1) % pts.length]]);
    pts.splice(cut, 1);
  }
  tris.push(pts);
  return tris;
}

// Where along p→q (0..1) the height a part gives changes slope: its planes
// trading places, and (for the building) a cut.
function breaks(planes, p, q) {
  const ts = [];
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const [dp, dq] = [planeAt(planes[i], ...p) - planeAt(planes[j], ...p), planeAt(planes[i], ...q) - planeAt(planes[j], ...q)];
      if ((dp < 0) !== (dq < 0) && dp !== dq) ts.push(dp / (dp - dq));
    }
  }
  return ts;
}

/**
 * A fitted roof and its walls into the mesh: walls from y0 up to the roof
 * (a gable end is a triangle of wall), each plane's share of the footprint as
 * the roof, and a step of wall where two parts meet at different heights.
 * `base` is the ground's height at (cx, cz).
 */
export function roofMesh(m, ring, rec, base, y0, wall, roof) {
  const [cx, cz, angle, cuts] = rec;
  const parts = roofParts(ring, rec);
  const [ux, uz] = axis(angle);
  const u0 = cx * ux + cz * uz;
  const height = (x, z) => base + roofHeight(ring, rec, x, z, parts);
  // The walls: each edge split where the roof over it changes slope.
  for (let i = 0; i < ring.length; i++) {
    const [p, q] = [ring[i], ring[(i + 1) % ring.length]];
    const ts = [0, 1];
    for (const c of cuts) {
      const [dp, dq] = [p[0] * ux + p[1] * uz - u0 - c, q[0] * ux + q[1] * uz - u0 - c];
      if ((dp < 0) !== (dq < 0)) ts.push(dp / (dp - dq));
    }
    for (const part of parts) ts.push(...breaks(part.planes, p, q));
    ts.sort((a, b) => a - b);
    const out = [(p[0] + q[0]) / 2 - cx, 0, (p[1] + q[1]) / 2 - cz];
    for (let k = 0; k + 1 < ts.length; k++) {
      if (ts[k + 1] - ts[k] < 1e-6) continue;
      const at = (t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      const [a, b] = [at(ts[k]), at(ts[k + 1])];
      // (Each end's height from the part the piece is in, so a step at a cut stays sharp.)
      const mid = at((ts[k] + ts[k + 1]) / 2);
      const planes = parts[partAt(rec, ...mid)].planes;
      const [ha, hb] = [base + surfaceAt(planes, ...a), base + surfaceAt(planes, ...b)];
      m.triFacing([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], hb, b[1]], wall, out);
      m.triFacing([a[0], y0, a[1]], [b[0], hb, b[1]], [a[0], ha, a[1]], wall, out);
    }
  }
  // The roof: each plane over where it's the lowest.
  for (const { region, planes } of parts) {
    planes.forEach((pl, i) => {
      let piece = region;
      planes.forEach((other, j) => {
        if (j === i || piece.length < 3) return;
        // pl <= other: (A - A') + (B - B') x + (C - C') z <= 0; a tie goes to the first.
        const [dA, dB, dC] = [pl[0] - other[0], pl[1] - other[1], pl[2] - other[2]];
        if (Math.abs(dB) + Math.abs(dC) < 1e-9) { if (dA > 0 || (dA === 0 && j < i)) piece = []; return; }
        piece = clipHalf(piece, dB, dC, -dA);
      });
      for (const t of triangulate(piece)) m.tri(...t.map(([x, z]) => [x, base + planeAt(pl, x, z), z]), roof);
    });
  }
  // The steps between parts: along each cut, inside the footprint, from the lower roof up to the higher.
  cuts.forEach((c, k) => {
    const [vx, vz] = [-uz, ux];
    const origin = [cx + ux * c, cz + uz * c];
    const crossings = [];
    for (let i = 0; i < ring.length; i++) {
      const [p, q] = [ring[i], ring[(i + 1) % ring.length]];
      const [dp, dq] = [p[0] * ux + p[1] * uz - u0 - c, q[0] * ux + q[1] * uz - u0 - c];
      if ((dp < 0) === (dq < 0)) continue;
      const t = dp / (dp - dq);
      const x = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      crossings.push((x[0] - origin[0]) * vx + (x[1] - origin[1]) * vz);
    }
    crossings.sort((a, b) => a - b);
    const [A, B] = [parts[k].planes, parts[k + 1].planes];
    for (let n = 0; n + 1 < crossings.length; n += 2) {
      const at = (s) => [origin[0] + vx * s, origin[1] + vz * s];
      const [p, q] = [at(crossings[n]), at(crossings[n + 1])];
      const ts = [0, 1, ...breaks(A, p, q), ...breaks(B, p, q), ...breaks([...A, ...B], p, q)].sort((a, b) => a - b);
      for (let i = 0; i + 1 < ts.length; i++) {
        if (ts[i + 1] - ts[i] < 1e-6) continue;
        const pt = (t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        const [a, b] = [pt(ts[i]), pt(ts[i + 1])];
        const [la, lb, ra, rb] = [surfaceAt(A, ...a), surfaceAt(A, ...b), surfaceAt(B, ...a), surfaceAt(B, ...b)];
        if (Math.abs(la - ra) < 0.05 && Math.abs(lb - rb) < 0.05) continue;
        // Facing the lower side: towards part k (-u) where it's lower.
        const out = la + lb < ra + rb ? [-ux, 0, -uz] : [ux, 0, uz];
        m.triFacing([a[0], base + la, a[1]], [b[0], base + lb, b[1]], [b[0], base + rb, b[1]], wall, out);
        m.triFacing([a[0], base + la, a[1]], [b[0], base + rb, b[1]], [a[0], base + ra, a[1]], wall, out);
      }
    }
  });
}
