// Procedural low-poly geometry: everything in the scene is built here from
// code, so there are no model files. Flat-shaded triangles with per-vertex
// colour; vertices are interleaved as position, normal, colour (9 floats).

export class MeshBuilder {
  data = [];
  count = 0;

  // One flat-shaded triangle. Winding doesn't matter: the renderer doesn't cull.
  tri(a, b, c, color) {
    const u = sub(b, a);
    const v = sub(c, a);
    let n = normalize(cross(u, v));
    if (n[1] < 0) n = n.map((x) => -x); // keep normals facing up-ish for lighting
    for (const p of [a, b, c]) this.data.push(...p, ...n, ...color);
    this.count += 3;
  }

  // Like tri() but keeps the true facing normal, for vertical surfaces like hull sides.
  triFacing(a, b, c, color, outward) {
    const n0 = normalize(cross(sub(b, a), sub(c, a)));
    const n = dot(n0, outward) < 0 ? n0.map((x) => -x) : n0;
    for (const p of [a, b, c]) this.data.push(...p, ...n, ...color);
    this.count += 3;
  }

  quad(a, b, c, d, color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  // Upright cone, e.g. a tree crown or a distant hill.
  cone([x, y, z], radius, height, segments, color, shade = 0.12) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * radius, y, z + Math.sin(a0) * radius];
      const p1 = [x + Math.cos(a1) * radius, y, z + Math.sin(a1) * radius];
      const out = [Math.cos((a0 + a1) / 2), 0.3, Math.sin((a0 + a1) / 2)];
      const k = 1 - shade + shade * 2 * ((i * 7) % segments) / segments;
      this.triFacing(p0, p1, [x, y + height, z], color.map((c) => c * k), out);
    }
  }

  // Vertical cylinder (posts, trunks), open at both ends.
  cylinder([x, y, z], radius, height, segments, color) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const b0 = [x + Math.cos(a0) * radius, y, z + Math.sin(a0) * radius];
      const b1 = [x + Math.cos(a1) * radius, y, z + Math.sin(a1) * radius];
      const t0 = [b0[0], y + height, b0[2]];
      const t1 = [b1[0], y + height, b1[2]];
      const out = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      this.triFacing(b0, b1, t1, color, out);
      this.triFacing(b0, t1, t0, color, out);
    }
  }

  // Axis-aligned box from min to max corner.
  box([x0, y0, z0], [x1, y1, z1], color) {
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const faces = [[0, 1, 2, 3, [0, 0, -1]], [5, 4, 7, 6, [0, 0, 1]], [4, 0, 3, 7, [-1, 0, 0]], [1, 5, 6, 2, [1, 0, 0]], [3, 2, 6, 7, [0, 1, 0]], [4, 5, 1, 0, [0, -1, 0]]];
    for (const [a, b, d, e, out] of faces) {
      this.triFacing(c[a], c[b], c[d], color, out);
      this.triFacing(c[a], c[d], c[e], color, out);
    }
  }

  // Six-sided solid between a bottom and a top quad (each listed going round),
  // e.g. a torso that tapers from hips to shoulders.
  prism(bottom, top, color) {
    const centre = [...bottom, ...top].reduce((a, p) => a.map((v, i) => v + p[i] / 8), [0, 0, 0]);
    const face = (a, b, c, d) => {
      const out = sub([0, 1, 2].map((i) => (a[i] + b[i] + c[i] + d[i]) / 4), centre);
      this.triFacing(a, b, c, color, out);
      this.triFacing(a, c, d, color, out);
    };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      face(bottom[i], bottom[j], top[j], top[i]);
    }
    face(...top);
    face(...bottom);
  }

  // Low-poly ball (buoys).
  sphere([x, y, z], radius, color, rings = 5, segments = 8) {
    const point = (r, s) => {
      const phi = (r / rings) * Math.PI;
      const theta = (s / segments) * Math.PI * 2;
      return [x + Math.sin(phi) * Math.cos(theta) * radius, y + Math.cos(phi) * radius, z + Math.sin(phi) * Math.sin(theta) * radius];
    };
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segments; s++) {
        const a = point(r, s);
        const b = point(r, s + 1);
        const c = point(r + 1, s + 1);
        const d = point(r + 1, s);
        const mid = point(r + 0.5, s + 0.5);
        const out = sub(mid, [x, y, z]);
        this.triFacing(a, b, c, color, out);
        this.triFacing(a, c, d, color, out);
      }
    }
  }

  build() {
    return { vertices: new Float32Array(this.data), count: this.count };
  }
}

// A marathon K1, about 5.2 m long, in boat space: x right, y up, -z forward.
// The paddler's eye sits just behind the origin.
// `beam` scales the width: narrower racing hulls, wider stable ones.
// `wings`: the deck flares out at the cockpit, a diamond (boats.js DECKS);
// `vee`: a V'd keel instead of a rounded bottom.
export function kayakMesh({ deck, hull, stripe, cockpit = [0.05, 0.05, 0.06], beam = 1, wings = false, vee = false }) {
  const m = new MeshBuilder();
  const bow = -3.3;
  const stern = 1.9;
  const stations = 28;
  const ring = (z) => {
    const t = (z - bow) / (stern - bow); // 0 at the bow, 1 at the stern
    const shape = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.75;
    const w = 0.235 * beam * shape;
    const wing = wings ? 0.075 * Math.max(0, 1 - Math.abs(z) / 1.7) : 0; // at deck level only
    const top = 0.05 + 0.1 * shape;
    const [keel, bilge] = vee ? [-0.2, -0.07] : [-0.15, -0.12];
    return [
      [-w - wing, 0.02 + wing * 0.3, z], [-w * 0.55 - wing * 0.6, top * 0.9, z], [0, top, z], [w * 0.55 + wing * 0.6, top * 0.9, z],
      [w + wing, 0.02 + wing * 0.3, z], [w * 0.6, bilge * shape, z], [0, keel * shape, z], [-w * 0.6, bilge * shape, z],
    ];
  };
  for (let i = 0; i < stations; i++) {
    const z0 = bow + ((stern - bow) * i) / stations;
    const z1 = bow + ((stern - bow) * (i + 1)) / stations;
    const a = ring(z0);
    const b = ring(z1);
    const inCockpit = (z0 + z1) / 2 > -0.55 && (z0 + z1) / 2 < 0.55;
    for (let k = 0; k < 8; k++) {
      const k2 = (k + 1) % 8;
      const isDeck = k < 4;
      let color = isDeck ? deck : hull;
      if (isDeck && inCockpit && (k === 1 || k === 2)) color = cockpit;
      else if (isDeck && (k === 1 || k === 2) && !inCockpit) color = stripe;
      const out = [(a[k][0] + b[k2][0]) / 2, (a[k][1] + b[k2][1]) / 2, 0];
      m.triFacing(a[k], b[k], b[k2], color, out);
      m.triFacing(a[k], b[k2], a[k2], color, out);
    }
  }
  return m.build();
}

// A paddle, shaft along x, centred on the origin, blades facing -z: wing
// blades (spoon-shaped, cupped) unless `flat`.
export function paddleMesh({ shaft, blade, flat = false }) {
  const m = new MeshBuilder();
  const half = 1.08;
  // Square-ish shaft: four long thin quads.
  const r = 0.016;
  const corners = [[0, r, r], [0, r, -r], [0, -r, -r], [0, -r, r]];
  for (let i = 0; i < 4; i++) {
    const [, y0, z0] = corners[i];
    const [, y1, z1] = corners[(i + 1) % 4];
    const out = [0, (y0 + y1) / 2, (z0 + z1) / 2];
    m.triFacing([-half, y0, z0], [half, y0, z0], [half, y1, z1], shaft, out);
    m.triFacing([-half, y0, z0], [half, y1, z1], [-half, y1, z1], shaft, out);
  }
  // Blades: a curved spoon at each end, slightly cupped towards -z.
  for (const side of [-1, 1]) {
    const x0 = side * (half - 0.42);
    const x1 = side * (half + 0.06);
    const cols = 6;
    for (let i = 0; i < cols; i++) {
      const f0 = i / cols;
      const f1 = (i + 1) / cols;
      const width = flat
        ? (f) => 0.03 + 0.09 * Math.min(1, f * 3) * (1 - 0.15 * f)
        : (f) => 0.03 + 0.12 * Math.sin(Math.PI * Math.min(1, f * 1.1)) ** 0.6;
      const cup = (f) => (flat ? 0 : 0.03 * Math.sin(Math.PI * f));
      const upper = flat ? 1 : 0.7; // a wing blade is lopsided
      const xa = x0 + (x1 - x0) * f0;
      const xb = x0 + (x1 - x0) * f1;
      const a = [xa, -width(f0), -cup(f0)];
      const b = [xb, -width(f1), -cup(f1)];
      const c = [xb, width(f1) * upper, -cup(f1)];
      const d = [xa, width(f0) * upper, -cup(f0)];
      m.triFacing(a, b, c, blade, [0, 0, -1]);
      m.triFacing(a, c, d, blade, [0, 0, -1]);
    }
  }
  return m.build();
}

// A paddler from the hips up, in boat space, sitting at the cockpit, facing
// -z: a man's or a woman's build (`body`), a face, hair (`hair`, in
// `hairColour`) under a hat (`hat`, in `cap`'s colour), a beard or not, a
// buoyancy aid over the top if `aid` is its colour, and sunglasses unless
// `glasses` is 'none' (lenses in `lens`). Arms are separate (see limbMesh),
// from `shoulderOf(body)`.
export const SEAT = 0.15; // z of the paddler's hips
export const SHOULDER = { x: 0.2, y: 0.58 };
const SHOULDERS = { man: SHOULDER, woman: { x: 0.175, y: 0.56 } };
export const shoulderOf = (body) => SHOULDERS[body] ?? SHOULDER;
// The torso as rings up from the seat: [y, half width, depth in front, depth
// behind], each an eight-sided ring (the corners cut off).
const TORSO = {
  man: [[0.08, 0.16, 0.11, 0.11], [0.38, 0.17, 0.125, 0.115], [0.5, 0.2, 0.12, 0.105], [0.6, 0.22, 0.1, 0.1]],
  woman: [[0.08, 0.155, 0.105, 0.105], [0.25, 0.13, 0.095, 0.095], [0.4, 0.15, 0.135, 0.1], [0.48, 0.165, 0.125, 0.095], [0.58, 0.19, 0.09, 0.09]],
};
const FRAME = [0.08, 0.08, 0.09];
const EYES = [0.07, 0.06, 0.06];
const LIPS = [0.55, 0.28, 0.27];
// Each lens's half width and height, and how far below the eyeline it hangs.
const LENSES = { round: [0.024, 0.016, 0], aviator: [0.026, 0.022, 0.006], square: [0.028, 0.015, 0] };
const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
// Eight-sided rings joined bottom to top, with a lid on the top one.
function loft(m, rings, color) {
  const round = ([y, w, f, b]) => {
    const c = 0.35 * Math.min(w, f, b);
    return [[-w + c, -f], [w - c, -f], [w, -f + c], [w, b - c], [w - c, b], [-w + c, b], [-w, b - c], [-w, -f + c]].map(([x, z]) => [x, y, z]);
  };
  const pts = rings.map(round);
  for (let r = 1; r < pts.length; r++) {
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      const [a, b, c, d] = [pts[r - 1][i], pts[r - 1][j], pts[r][j], pts[r][i]];
      const out = [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
      m.triFacing(a, b, c, color, out);
      m.triFacing(a, c, d, color, out);
    }
  }
  const lid = pts[pts.length - 1];
  const mid = [0, lid[0][1], (lid[0][2] + lid[4][2]) / 2];
  for (let i = 0; i < 8; i++) m.triFacing(mid, lid[i], lid[(i + 1) % 8], color, [0, 1, 0]);
}
export function paddlerMesh({ top, skin, cap, body = 'man', hair = 'short', hairColour = [0.23, 0.14, 0.08], hat = 'cap', beard = 'none', aid = null, glasses = 'none', lens = FRAME }) {
  const m = new MeshBuilder();
  const woman = body === 'woman';
  const rings = TORSO[woman ? 'woman' : 'man'];
  loft(m, rings, top);
  if (aid) {
    // A buoyancy aid: a padded vest from the ribs up over the shoulders, and
    // a buckled strap across the front.
    const lo = rings[0][0] + 0.1;
    const at = (y) => {
      for (let i = 1; i < rings.length; i++) {
        const [a, b] = [rings[i - 1], rings[i]];
        if (y <= b[0]) { const t = (y - a[0]) / (b[0] - a[0]); return a.map((v, k) => v + (b[k] - v) * t); }
      }
      return rings[rings.length - 1];
    };
    const pad = 0.03;
    const grow = ([y, w, f, b]) => [y, w + pad * 0.6, f + pad, b + pad * 0.8];
    const vest = [at(lo), ...rings.filter((r) => r[0] > lo)].map(grow);
    vest[vest.length - 1][0] += 0.012;
    loft(m, vest, aid);
    const [, w, f] = grow(at(lo + 0.08));
    m.box([-w - 0.004, lo + 0.06, -f - 0.008], [w + 0.004, lo + 0.1, -f + 0.02], mix(aid, [0, 0, 0], 0.7));
    m.box([-0.025, lo + 0.055, -f - 0.014], [0.025, lo + 0.105, -f], [0.75, 0.75, 0.72]); // the buckle
  }
  const neck = shoulderOf(body).y;
  m.cylinder([0, neck, 0], woman ? 0.042 : 0.05, 0.12, 6, skin);
  m.sphere([0, 0.77, -0.01], 0.105, skin, 5, 8);
  // The face looks down -z; the eyes are about y 0.785.
  const brow = hair === 'none' ? mix(skin, [0.1, 0.08, 0.06], 0.5) : hairColour;
  for (const side of [-1, 1]) {
    const x = side * 0.038;
    m.box([x - 0.011, 0.781, -0.116], [x + 0.011, 0.793, -0.104], EYES);
    m.box([x - 0.019, 0.804, -0.113], [x + 0.019, 0.811, -0.1], brow);
  }
  m.box([-0.011, 0.752, -0.124], [0.011, 0.778, -0.108], mix(skin, [0, 0, 0], 0.08)); // the nose
  m.box([-0.024, 0.733, -0.112], [0.024, woman ? 0.742 : 0.739, -0.1], woman ? LIPS : mix(skin, [0.35, 0.1, 0.1], 0.45));
  if (beard === 'beard' || beard === 'stubble') {
    m.sphere([0, 0.742, -0.022], 0.096, beard === 'beard' ? hairColour : mix(skin, hairColour, 0.35), 4, 8);
    m.box([-0.022, 0.729, -0.122], [0.022, 0.737, -0.11], beard === 'beard' ? mix(hairColour, [0, 0, 0], 0.4) : LIPS); // the mouth, through it
  }
  if (beard === 'moustache' || beard === 'beard') m.box([-0.034, 0.743, -0.122], [0.034, 0.754, -0.104], hairColour);
  // Hair: a crown unless a cap or beanie sits on it (a visor has no crown),
  // then whatever shows below the hat.
  const hatted = hat === 'cap' || hat === 'beanie';
  if (hair !== 'none') {
    if (!hatted) {
      if (hair === 'crop') m.sphere([0, 0.8, 0.02], 0.1, hairColour, 3, 8);
      else m.sphere([0, 0.795, 0.015], 0.108, hairColour, 3, 8);
    }
    if (hair !== 'crop') m.box([-0.09, 0.7, 0.02], [0.09, 0.8, 0.11], hairColour); // the back of the head
    if (hair === 'ponytail') {
      m.box([-0.02, 0.78, 0.1], [0.02, 0.81, 0.13], mix(hairColour, [0, 0, 0], 0.5)); // the tie
      m.prism([[-0.03, 0.79, 0.12], [0.03, 0.79, 0.12], [0.03, 0.79, 0.16], [-0.03, 0.79, 0.16]],
        [[-0.018, 0.6, 0.15], [0.018, 0.6, 0.15], [0.018, 0.6, 0.18], [-0.018, 0.6, 0.18]], hairColour);
    } else if (hair === 'bun') {
      m.sphere(hatted ? [0, 0.79, 0.12] : [0, 0.86, 0.09], 0.045, hairColour, 3, 6);
    } else if (hair === 'long') {
      m.prism([[-0.095, 0.8, 0.02], [0.095, 0.8, 0.02], [0.095, 0.8, 0.12], [-0.095, 0.8, 0.12]],
        [[-0.11, 0.56, 0.04], [0.11, 0.56, 0.04], [0.11, 0.56, 0.12], [-0.11, 0.56, 0.12]], hairColour);
      for (const side of [-1, 1]) m.box([side * 0.1 - 0.012, 0.66, -0.04], [side * 0.1 + 0.012, 0.8, 0.06], hairColour);
    }
  }
  if (hat === 'cap') {
    m.sphere([0, 0.81, 0.0], 0.1, cap, 3, 8);
    m.box([-0.08, 0.79, -0.15], [0.08, 0.805, -0.07], cap); // peak
  } else if (hat === 'visor') {
    m.cylinder([0, 0.8, -0.005], 0.109, 0.03, 10, cap);
    m.box([-0.08, 0.8, -0.16], [0.08, 0.812, -0.07], cap);
  } else if (hat === 'beanie') {
    m.sphere([0, 0.805, 0.005], 0.112, cap, 4, 8);
    m.cylinder([0, 0.77, 0.0], 0.115, 0.035, 10, mix(cap, [0, 0, 0], 0.2)); // the turn-up
    m.sphere([0, 0.925, 0.005], 0.026, mix(cap, [1, 1, 1], 0.5), 2, 6); // the bobble
  }
  if (glasses === 'wrap') {
    m.box([-0.088, 0.772, -0.124], [0.088, 0.8, -0.1], lens);
  } else if (LENSES[glasses]) {
    const [hw, hh, drop] = LENSES[glasses];
    for (const side of [-1, 1]) {
      const x = side * 0.04;
      m.box([x - hw, 0.786 - hh - drop, -0.124], [x + hw, 0.786 + hh - drop, -0.104], lens);
    }
    m.box([-0.016, 0.785, -0.122], [0.016, 0.792, -0.108], FRAME); // the bridge
    m.box([-0.106, 0.783, -0.11], [-0.09, 0.791, 0.02], FRAME); // arms
    m.box([0.09, 0.783, -0.11], [0.106, 0.791, 0.02], FRAME);
  }
  return m.build();
}

// A unit-length arm along +z, 1 unit across; a model matrix stretches it
// from shoulder to hand. A short sleeve covers the first `sleeve` of it, the
// rest is bare (`skin`).
export function limbMesh(color, { skin = color, sleeve = 1 } = {}) {
  const m = new MeshBuilder();
  m.box([-0.5, -0.5, 0], [0.5, 0.5, sleeve], color);
  if (sleeve < 1) m.box([-0.45, -0.45, sleeve], [0.45, 0.45, 1], skin);
  return m.build();
}

// Flat grid of (x, z) points centred on the origin, for the water surface.
// A mute swan on the water, facing -z: a boat-shaped body with raised wings,
// the long neck in an S, an orange bill with its black knob.
export function swanMesh() {
  const m = new MeshBuilder();
  const white = [0.96, 0.96, 0.94];
  const shade = [0.86, 0.86, 0.84];
  m.prism([[-0.22, 0, -0.35], [0.22, 0, -0.35], [0.24, 0, 0.45], [-0.24, 0, 0.45]],
    [[-0.26, 0.22, -0.4], [0.26, 0.22, -0.4], [0.28, 0.28, 0.5], [-0.28, 0.28, 0.5]], white);
  m.prism([[-0.24, 0.22, -0.25], [0.24, 0.22, -0.25], [0.26, 0.28, 0.45], [-0.26, 0.28, 0.45]],
    [[-0.12, 0.36, -0.1], [0.12, 0.36, -0.1], [0.1, 0.42, 0.55], [-0.1, 0.42, 0.55]], shade);
  m.prism([[-0.06, 0.2, -0.32], [0.06, 0.2, -0.32], [0.06, 0.2, -0.22], [-0.06, 0.2, -0.22]],
    [[-0.05, 0.55, -0.42], [0.05, 0.55, -0.42], [0.05, 0.55, -0.34], [-0.05, 0.55, -0.34]], white);
  m.prism([[-0.05, 0.55, -0.42], [0.05, 0.55, -0.42], [0.05, 0.55, -0.34], [-0.05, 0.55, -0.34]],
    [[-0.045, 0.78, -0.36], [0.045, 0.78, -0.36], [0.045, 0.78, -0.28], [-0.045, 0.78, -0.28]], white);
  m.box([-0.055, 0.74, -0.46], [0.055, 0.84, -0.28], white);
  m.box([-0.03, 0.75, -0.6], [0.03, 0.8, -0.46], [0.95, 0.45, 0.1]);
  m.box([-0.035, 0.78, -0.5], [0.035, 0.83, -0.45], [0.08, 0.08, 0.08]);
  return m.build();
}

// A mallard drake: brown body, grey back, green head, yellow bill.
export function duckMesh() {
  const m = new MeshBuilder();
  m.prism([[-0.1, 0, -0.18], [0.1, 0, -0.18], [0.1, 0, 0.2], [-0.1, 0, 0.2]],
    [[-0.12, 0.13, -0.2], [0.12, 0.13, -0.2], [0.11, 0.16, 0.26], [-0.11, 0.16, 0.26]], [0.45, 0.32, 0.22]);
  m.box([-0.09, 0.13, -0.1], [0.09, 0.19, 0.22], [0.62, 0.62, 0.6]);
  m.box([-0.05, 0.14, -0.24], [0.05, 0.3, -0.12], [0.1, 0.38, 0.18]);
  m.box([-0.025, 0.2, -0.32], [0.025, 0.24, -0.24], [0.95, 0.8, 0.2]);
  return m.build();
}

export function waterGrid(cells, size) {
  const step = size / cells;
  const half = size / 2;
  const out = new Float32Array(cells * cells * 6 * 2);
  let o = 0;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x0 = -half + i * step;
      const z0 = -half + j * step;
      const x1 = x0 + step;
      const z1 = z0 + step;
      out.set([x0, z0, x1, z0, x1, z1, x0, z0, x1, z1, x0, z1], o);
      o += 12;
    }
  }
  return out;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalize(v) {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
}

// --- other boats on the river (traffic.js) ----------------------------------
// In boat space like a kayak (x right, y up, -z forward), centred on the boat's
// middle, `length` long. Rowers face the stern; their oars are separate
// (oarMesh), swung by main.js.

// A long low shell, pointed at both ends: deck and hull, `beam` wide.
function shell(m, length, beam, { deck, hull, top = 0.12, depth = 0.14 }) {
  const stations = 24;
  const ring = (z) => {
    const t = (z + length / 2) / length;
    const shape = Math.sin(Math.PI * t) ** 0.55;
    const w = (beam / 2) * shape;
    return [[-w, 0.03, z], [0, top * shape + 0.03, z], [w, 0.03, z], [0, -depth * shape, z]];
  };
  for (let i = 0; i < stations; i++) {
    const a = ring(-length / 2 + (length * i) / stations);
    const b = ring(-length / 2 + (length * (i + 1)) / stations);
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      const out = [(a[k][0] + b[k2][0]) / 2, (a[k][1] + b[k2][1]) / 2, 0];
      m.triFacing(a[k], b[k], b[k2], k < 2 ? deck : hull, out);
      m.triFacing(a[k], b[k2], a[k2], k < 2 ? deck : hull, out);
    }
  }
}

// Where a rowing boat's oars pivot, and which way each points (-1 left, 1
// right), stern seat first: one sculler's pair, or an eight's sweep oars.
export const ROWLOCKS = {
  sculler: [[-1, 0.75, 0.4], [1, 0.75, 0.4]],
  eight: Array.from({ length: 8 }, (_, k) => [k % 2 ? 1 : -1, 0.82, 4.9 - k * 1.35]),
};

// A rower faces the stern, sitting this far towards the bow from their rowlock.
const SEAT_BACK = 0.55;
const ROWER = { kit: [0.12, 0.25, 0.6], skin: [0.8, 0.6, 0.45], cap: [0.9, 0.9, 0.9] };
function rower(m, z) {
  m.box([-0.17, 0.08, z - 0.1], [0.17, 0.55, z + 0.12], ROWER.kit);
  m.sphere([0, 0.68, z + 0.05], 0.1, ROWER.skin, 4, 7);
  m.sphere([0, 0.72, z + 0.05], 0.095, ROWER.cap, 3, 7);
}

export function scullerMesh() {
  const m = new MeshBuilder();
  shell(m, 8.2, 0.3, { deck: [0.95, 0.95, 0.93], hull: [0.92, 0.92, 0.9], top: 0.08, depth: 0.12 });
  for (const [side, x, z] of ROWLOCKS.sculler) m.box([Math.min(0, side * x), 0.18, z - 0.03], [Math.max(0, side * x), 0.22, z + 0.03], [0.6, 0.6, 0.62]);
  rower(m, 0.4 - SEAT_BACK);
  return m.build();
}

export function eightMesh() {
  const m = new MeshBuilder();
  shell(m, 17.5, 0.62, { deck: [0.85, 0.88, 0.92], hull: [0.2, 0.3, 0.55], top: 0.1, depth: 0.16 });
  for (const [side, x, z] of ROWLOCKS.eight) {
    m.box([Math.min(0, side * x), 0.18, z - 0.03], [Math.max(0, side * x), 0.22, z + 0.03], [0.6, 0.6, 0.62]);
    rower(m, z - SEAT_BACK);
  }
  // The cox, in the stern facing the crew (and forward), with a cap.
  m.box([-0.15, 0.05, 7.05], [0.15, 0.35, 7.35], [0.9, 0.35, 0.1]);
  m.sphere([0, 0.47, 7.15], 0.1, ROWER.skin, 4, 7);
  m.sphere([0, 0.51, 7.15], 0.095, [0.9, 0.35, 0.1], 3, 7);
  return m.build();
}

// A white river cruiser: a broad hull, a cabin with windows, people aboard.
export function cruiserMesh() {
  const m = new MeshBuilder();
  const white = [0.95, 0.95, 0.93];
  m.prism([[-1.5, -0.4, 4.6], [1.5, -0.4, 4.6], [1.5, -0.4, -4.4], [-1.5, -0.4, -4.4]],
    [[-1.75, 0.6, 5.4], [1.75, 0.6, 5.4], [1.75, 0.6, -4.6], [-1.75, 0.6, -4.6]], white);
  m.prism([[-0.8, -0.4, -4.4], [0.8, -0.4, -4.4], [0.1, -0.4, -5.4], [-0.1, -0.4, -5.4]],
    [[-1.75, 0.6, -4.6], [1.75, 0.6, -4.6], [0.15, 0.7, -5.6], [-0.15, 0.7, -5.6]], white); // the bow
  m.box([-1.78, 0.25, -4.6], [1.78, 0.38, 5.4], [0.1, 0.25, 0.55]); // a band round her
  m.box([-1.35, 0.6, -2.6], [1.35, 1.75, 2.8], white);
  m.box([-1.37, 1.05, -2.4], [1.37, 1.45, 2.6], [0.15, 0.2, 0.28]); // windows
  m.box([-1.45, 1.75, -2.8], [1.45, 1.85, 3.0], [0.1, 0.25, 0.55]);
  for (const [x, z, top] of [[-0.7, 4.2, [0.9, 0.2, 0.2]], [0.6, 3.8, [0.95, 0.8, 0.2]]]) {
    m.box([x - 0.17, 0.6, z - 0.12], [x + 0.17, 1.25, z + 0.12], top);
    m.sphere([x, 1.38, z], 0.11, ROWER.skin, 4, 7);
  }
  return m.build();
}

// A small motorboat: a planing hull, a windscreen and the driver.
export function motorboatMesh() {
  const m = new MeshBuilder();
  const hull = [0.9, 0.9, 0.88];
  m.prism([[-0.9, -0.3, 2.9], [0.9, -0.3, 2.9], [0.6, -0.3, -1.8], [-0.6, -0.3, -1.8]],
    [[-1.2, 0.45, 3], [1.2, 0.45, 3], [1.1, 0.45, -1.8], [-1.1, 0.45, -1.8]], hull);
  m.prism([[-0.6, -0.3, -1.8], [0.6, -0.3, -1.8], [0.05, 0.1, -3], [-0.05, 0.1, -3]],
    [[-1.1, 0.45, -1.8], [1.1, 0.45, -1.8], [0.08, 0.55, -3.05], [-0.08, 0.55, -3.05]], hull);
  m.box([-1.22, 0.2, -1.8], [1.22, 0.32, 3], [0.8, 0.15, 0.15]); // a stripe
  m.box([-0.9, 0.45, -0.9], [0.9, 0.95, -0.8], [0.45, 0.6, 0.7]); // the windscreen
  m.box([0.15, 0.45, -0.1], [0.55, 1.05, 0.25], [0.2, 0.2, 0.25]);
  m.sphere([0.35, 1.18, 0.05], 0.11, ROWER.skin, 4, 7);
  m.box([-0.4, 0.45, 2.75], [0.4, 0.85, 3.2], [0.15, 0.15, 0.18]); // the outboard
  return m.build();
}

// A kayaker out paddling (river traffic): a club touring boat with its paddler
// sitting in it and arms forward to the paddle, which main.js swings.
export function kayakerMesh({ deck = [0.15, 0.45, 0.75], hull = [0.92, 0.92, 0.9], stripe = [0.95, 0.95, 0.95], top = [0.95, 0.75, 0.15], skin = [0.82, 0.62, 0.48], cap = [0.15, 0.45, 0.75] } = {}) {
  const boat = kayakMesh({ deck, hull, stripe, beam: 1.15 });
  const body = paddlerMesh({ top, skin, cap });
  const m = new MeshBuilder();
  for (const side of [-1, 1]) m.prism([[side * 0.18, SHOULDER.y - 0.06, SEAT - 0.04], [side * 0.26, SHOULDER.y - 0.06, SEAT - 0.04], [side * 0.26, SHOULDER.y, SEAT + 0.04], [side * 0.18, SHOULDER.y, SEAT + 0.04]],
    [[side * 0.3, 0.44, SEAT - 0.5], [side * 0.36, 0.44, SEAT - 0.5], [side * 0.36, 0.5, SEAT - 0.44], [side * 0.3, 0.5, SEAT - 0.44]], top);
  const arms = m.build();
  const seated = new Float32Array(body.vertices);
  for (let i = 2; i < seated.length; i += 9) seated[i] += SEAT;
  const vertices = new Float32Array(boat.vertices.length + seated.length + arms.vertices.length);
  vertices.set(boat.vertices, 0);
  vertices.set(seated, boat.vertices.length);
  vertices.set(arms.vertices, boat.vertices.length + seated.length);
  return { vertices, count: boat.count + body.count + arms.count };
}

// One oar along +z, from the rowlock (z 0) to the blade tip (z 1); x and y in
// metres, so stretching it along z keeps the blade's size.
export function oarMesh() {
  const m = new MeshBuilder();
  m.box([-0.035, -0.035, 0], [0.035, 0.035, 0.84], [0.95, 0.95, 0.93]);
  m.box([-0.02, -0.12, 0.82], [0.02, 0.12, 1], [0.15, 0.3, 0.75]);
  return m.build();
}
