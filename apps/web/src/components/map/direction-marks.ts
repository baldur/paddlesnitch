// Small arrows along a line showing which way it was paddled, for maps where
// an out-and-back's two legs lie side by side. Pure: works in screen pixels
// (the map projects the line first), so the spacing looks the same at any zoom.

type XY = { x: number; y: number }

/** Only from this zoom in: further out the arrows would just be clutter. */
export const MARKS_MIN_ZOOM = 16

/** A mark every `spacing` px along the line: where, and its heading in degrees
 *  clockwise from pointing right (screen y grows downward, like CSS rotate). */
export function directionMarks(pts: XY[], spacing: number): { x: number; y: number; deg: number }[] {
  const out: { x: number; y: number; deg: number }[] = []
  let next = spacing / 2
  let walked = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y
    const len = Math.hypot(dx, dy)
    if (len === 0) continue
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI
    while (walked + len > next) {
      const f = (next - walked) / len
      out.push({ x: pts[i - 1].x + dx * f, y: pts[i - 1].y + dy * f, deg })
      next += spacing
    }
    walked += len
  }
  return out
}

/** A key that changes only when the lines do, so the map fits them once and
 *  not on every replay tick (a new array of the same points is the same key). */
export function linesKey(lines: [number, number][][]): string {
  return lines.map(l => (l.length ? `${l.length}:${l[0].join(',')}:${l[l.length - 1].join(',')}` : '0')).join('|')
}
