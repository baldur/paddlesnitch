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
