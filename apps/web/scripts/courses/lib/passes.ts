// Splitting a paddle into passes along a course: a trip out and back covers the
// same water twice, facing opposite ways, and each pass gives a different look
// at both banks. Pure; tested in passes.test.ts.

export type Placed = { t: number; s: number }   // seconds into the recording, metres along the course
export type Pass = { from: number; to: number; dir: 1 | -1 } // indexes into the placed fixes, inclusive

/**
 * Cut wherever the paddler turns round: once they've come back `turnM` from the
 * furthest point of the current pass, that point ends it. Passes shorter than
 * `minM` (milling about at the start, a lock) are dropped.
 */
export function passes(placed: Placed[], turnM = 100, minM = 200): Pass[] {
  const out: Pass[] = []
  if (placed.length < 2) return out
  let start = 0
  let ext = 0
  let dir: 1 | -1 | 0 = 0
  for (let i = 1; i < placed.length; i++) {
    const s = placed[i].s
    if (dir === 0) {
      // Not going anywhere yet: wait until they've moved turnM one way.
      if (Math.abs(s - placed[start].s) >= turnM) {
        dir = s > placed[start].s ? 1 : -1
        ext = i
      }
      continue
    }
    if ((s - placed[ext].s) * dir > 0) ext = i
    else if ((placed[ext].s - s) * dir >= turnM) {
      out.push({ from: start, to: ext, dir })
      start = ext
      dir = dir === 1 ? -1 : 1
      ext = i
    }
  }
  if (dir !== 0) out.push({ from: start, to: ext, dir })
  return out.filter((p) => Math.abs(placed[p.to].s - placed[p.from].s) >= minM)
}

/** For each step along the course a pass covers, the fix nearest it. */
export function stations(placed: Placed[], pass: Pass, step: number): Array<{ s: number; i: number }> {
  const lo = Math.min(placed[pass.from].s, placed[pass.to].s)
  const hi = Math.max(placed[pass.from].s, placed[pass.to].s)
  const out: Array<{ s: number; i: number }> = []
  for (let s = Math.ceil(lo / step) * step; s <= hi; s += step) {
    let best = pass.from
    for (let i = pass.from; i <= pass.to; i++) if (Math.abs(placed[i].s - s) < Math.abs(placed[best].s - s)) best = i
    out.push({ s, i: best })
  }
  return out
}
