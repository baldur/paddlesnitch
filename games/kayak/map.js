// The course map in the corner of the screen: the course's shape, start and
// finish, and a dot for each boat, so you can see a turn coming. North is up
// (the world's -z), the same every time, so the shape is one you can learn.
// Pure, no DOM: main.js draws it as SVG.
import { pointAt } from './course.js';

const POINTS = 240; // the most points the drawn line needs

// long: the map's longer side, its shorter side fitting the course (but at least
// `short`); pad: room round the edge for the dots.
export function courseMap(course, { long = 160, short = 40, pad = 8 } = {}) {
  const from = Math.max(0, course.start - 20);
  const to = Math.min(course.length, course.finish + 20);
  const shown = course.samples.filter((p) => p.s >= from && p.s <= to);
  const every = Math.max(1, Math.ceil(shown.length / POINTS));
  const line = shown.filter((_, i) => i % every === 0 || i === shown.length - 1);

  const xs = line.map((p) => p.x);
  const zs = line.map((p) => p.z);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const [spanX, spanZ] = [Math.max(maxX - minX, 1), Math.max(maxZ - minZ, 1)];
  const k = (long - 2 * pad) / Math.max(spanX, spanZ);
  // A long thin course gets a long thin map, so its turns are big enough to see.
  const width = spanX >= spanZ ? long : Math.max(short, spanX * k + 2 * pad);
  const height = spanX >= spanZ ? Math.max(short, spanZ * k + 2 * pad) : long;
  // Centred both ways.
  const ox = (width - spanX * k) / 2;
  const oz = (height - spanZ * k) / 2;
  const project = (x, z) => [ox + (x - minX) * k, oz + (z - minZ) * k];

  const d = line.map((p, i) => {
    const [x, y] = project(p.x, p.z);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join('');
  const mark = (s) => {
    const p = pointAt(course, s);
    return project(p.x, p.z);
  };
  return { width, height, d, project, start: mark(course.start), finish: mark(course.finish) };
}

// A boat's heading (0 = up the map, clockwise) in degrees, for rotating its arrow.
export function headingDegrees(heading) {
  return (heading * 180) / Math.PI;
}

// The close-up map: the open water near you, turned so ahead is up, for seeing
// how a bend goes before you're in it. closeUp gives the shapes once, in world
// metres (x east, z south); follow gives the turn that puts a boat in the
// middle, heading up.
const STEP = 3; // samples per stretch of water drawn

export function closeUp(course) {
  const { samples } = course;
  // Right of the direction of travel is (-tz, tx).
  const edges = (p) => [[p.x + p.tz * p.left, p.z - p.tx * p.left], [p.x - p.tz * p.right, p.z + p.tx * p.right]];
  const quads = [];
  for (let i = 0; i < samples.length - 1; i += STEP) {
    const [la, ra] = edges(samples[i]);
    const [lb, rb] = edges(samples[Math.min(i + STEP, samples.length - 1)]);
    let q = [la, lb, rb, ra];
    // Each wound the same way: where stretches overlap, the water stays filled.
    const area = q.reduce((a, [x, y], k) => { const [nx, ny] = q[(k + 1) % 4]; return a + x * ny - nx * y; }, 0);
    if (area < 0) q = q.reverse();
    quads.push(q.map(([x, z], k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${z.toFixed(1)}`).join('') + 'Z');
  }
  const across = (s) => {
    const [[x1, z1], [x2, z2]] = edges(samples[Math.round(s / (course.length / (samples.length - 1)))]);
    return [x1, z1, x2, z2];
  };
  // The racing line, for where the course goes at a split; and on a real river
  // its mapped water (islands as holes: fill it even-odd), so the islands and
  // other channels show as they are.
  const line = samples.filter((_, i) => i % 2 === 0 || i === samples.length - 1)
    .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.z.toFixed(1)}`).join('');
  const real = course.scenery?.water;
  const water = real?.length
    ? real.map((ring) => ring.map(([x, z], k) => `${k ? 'L' : 'M'}${x} ${z}`).join('') + 'Z').join('')
    : quads.join('');
  return { water, rule: real?.length ? 'evenodd' : 'nonzero', line, start: across(course.start), finish: across(course.finish) };
}

export function follow(boat) {
  return `rotate(${(-headingDegrees(boat.heading)).toFixed(2)}) translate(${(-boat.x).toFixed(2)} ${(-boat.z).toFixed(2)})`;
}
