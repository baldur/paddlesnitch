// What the owner's drone footage adds to materials.js, from the local vision
// model's looks (`pnpm --filter web course:look --drone`, then `--export`):
// rows as materials.js has them, by the middle of a plain building's footprint
// (x, z), filling only what the footage from the water left open (null). A
// roof only where at least three of the drone's views within 15 m of the
// footprint agree and it's the nearest footprint to them (its positions are
// rays onto the lidar from 250-400 m, so a lone view could be a neighbour's).
// Only these answers are here, never a picture.
export const DRONE_MATERIALS = [
  // White render (as the footage from the water saw it) under a red tile roof: three of four views.
  [-1010.9, -742.6, null, null, '#b22222', 'tile'],
];
