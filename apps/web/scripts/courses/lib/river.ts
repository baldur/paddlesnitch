// Pure geometry for turning a real river into a game course: a local metric
// projection, the river's centreline between two points, its width, and where
// things sit along it. No I/O, so it's tested on its own (river.test.ts).
//
// Game coordinates: x is east, z is SOUTH (so north is -z and the game's
// heading, atan2(tx, -tz), is a compass bearing). Metres throughout.

export type LatLng = [number, number]
export type XZ = [number, number]

const R = 6_371_000
const RAD = Math.PI / 180

/** Equirectangular around an origin: under a millimetre off over a few km. */
export function projection(origin: LatLng) {
  const k = Math.cos(origin[0] * RAD)
  return {
    toXZ: ([lat, lng]: LatLng): XZ => [(lng - origin[1]) * RAD * R * k, -(lat - origin[0]) * RAD * R],
    toLatLng: ([x, z]: XZ): LatLng => [origin[0] - z / (RAD * R), origin[1] + x / (RAD * R * k)],
  }
}

const dist = (a: XZ, b: XZ) => Math.hypot(b[0] - a[0], b[1] - a[1])

export function cumulative(line: XZ[]): number[] {
  const cum = [0]
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + dist(line[i - 1], line[i]))
  return cum
}

/** Nearest point on a polyline: distance along it, and signed offset (right of travel is +). */
export function locate(line: XZ[], cum: number[], p: XZ): { s: number; lateral: number; d: number } {
  let best = { s: 0, lateral: 0, d: Infinity }
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i]
    const [bx, bz] = line[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const len2 = dx * dx + dz * dz || 1
    const f = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / len2))
    const cx = ax + dx * f
    const cz = az + dz * f
    const d = Math.hypot(p[0] - cx, p[1] - cz)
    if (d < best.d) {
      const len = Math.sqrt(len2)
      // Right of the direction of travel is (-tz, tx), as in the game's course.js.
      best = { s: cum[i] + f * len, lateral: ((p[0] - cx) * -dz + (p[1] - cz) * dx) / len, d }
    }
  }
  return best
}

/** Point and unit direction at a distance along a polyline. */
export function at(line: XZ[], cum: number[], s: number): { p: XZ; t: XZ } {
  let i = 0
  while (i < cum.length - 2 && cum[i + 1] < s) i++
  const len = cum[i + 1] - cum[i] || 1
  const f = Math.max(0, Math.min(1, (s - cum[i]) / len))
  const [a, b] = [line[i], line[i + 1]]
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], t: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] }
}

/**
 * The river's line from `from` to `to` through a network of mapped river ways
 * (each a polyline; ways join where they share an end or vertex). Where the river
 * splits round an island, the channel nearer the `guide` points (a paddler's GPS
 * track) wins: each edge costs its length, more the further it strays from them.
 */
export function chainCentreline(ways: XZ[][], from: XZ, to: XZ, guide: XZ[]): XZ[] {
  const key = (p: XZ) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`
  const nodes = new Map<string, XZ>()
  const edges = new Map<string, Array<{ to: string; cost: number }>>()
  const nearGuide = (p: XZ) => guide.reduce((m, g) => Math.min(m, dist(p, g)), Infinity)
  for (const way of ways) {
    for (let i = 0; i < way.length - 1; i++) {
      const [a, b] = [way[i], way[i + 1]]
      const [ka, kb] = [key(a), key(b)]
      nodes.set(ka, a)
      nodes.set(kb, b)
      const mid: XZ = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const stray = guide.length ? nearGuide(mid) : 0
      const cost = dist(a, b) * (1 + (stray / 30) ** 2)
      for (const [x, y] of [[ka, kb], [kb, ka]]) edges.set(x, [...(edges.get(x) ?? []), { to: y, cost }])
    }
  }
  const nearest = (p: XZ) => [...nodes].reduce((m, [k, n]) => (dist(n, p) < m.d ? { k, d: dist(n, p) } : m), { k: '', d: Infinity }).k
  const [start, goal] = [nearest(from), nearest(to)]
  const best = new Map([[start, 0]])
  const prev = new Map<string, string>()
  const open = new Set([start])
  while (open.size) {
    let cur = ''
    for (const k of open) if (!cur || best.get(k)! < best.get(cur)!) cur = k
    open.delete(cur)
    if (cur === goal) break
    for (const e of edges.get(cur) ?? []) {
      const c = best.get(cur)! + e.cost
      if (c < (best.get(e.to) ?? Infinity)) {
        best.set(e.to, c)
        prev.set(e.to, cur)
        open.add(e.to)
      }
    }
  }
  if (!best.has(goal)) throw new Error('the river ways do not connect the two points')
  const path: XZ[] = []
  for (let k: string | undefined = goal; k; k = prev.get(k)) path.unshift(nodes.get(k)!)
  // Trim to the exact ends: the nearest mapped vertex can lie past an end, which
  // would leave a kink doubling back to it. Drop vertices while the end falls
  // inside the segment before them.
  const before = (a: XZ, b: XZ, p: XZ) => (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]) < dist(a, b) ** 2
  while (path.length >= 2 && before(path.at(-2)!, path.at(-1)!, to)) path.pop()
  while (path.length >= 2 && before(path[1], path[0], from)) path.shift()
  const ends = [from, ...path, to]
  return ends.filter((p, i) => i === 0 || dist(p, ends[i - 1]) > 0.5)
}

/** A polyline with points closer than `tol` metres to the last one kept dropped (the ends always stay). */
export function thinLine(line: XZ[], tol: number): XZ[] {
  const out = [line[0]]
  for (let i = 1; i < line.length - 1; i++) if (dist(line[i], out.at(-1)!) >= tol) out.push(line[i])
  if (line.length > 1) out.push(line.at(-1)!)
  return out
}

/** Even samples every `step` metres along a polyline. */
export function resample(line: XZ[], step: number): XZ[] {
  const cum = cumulative(line)
  const out: XZ[] = []
  for (let s = 0; s <= cum.at(-1)!; s += step) out.push(at(line, cum, s).p)
  return out
}

function hit(o: XZ, d: XZ, a: XZ, b: XZ): number | null {
  // Ray o + t·d against segment a→b; returns t ≥ 0 or null.
  const ex = b[0] - a[0]
  const ez = b[1] - a[1]
  const den = d[0] * ez - d[1] * ex
  if (Math.abs(den) < 1e-12) return null
  const t = ((a[0] - o[0]) * ez - (a[1] - o[1]) * ex) / den
  const u = ((a[0] - o[0]) * d[1] - (a[1] - o[1]) * d[0]) / den
  return t >= 0 && u >= 0 && u <= 1 ? t : null
}

/**
 * Distance from each centreline sample to the water's edge on its left and right,
 * cast square to the line against every shoreline segment (riverbanks, islands,
 * lock walls). `null` where nothing is found within `maxM`.
 */
export function banks(line: XZ[], shore: Array<[XZ, XZ]>, maxM = 150): Array<{ left: number | null; right: number | null }> {
  const cum = cumulative(line)
  return line.map((p, i) => {
    const { t } = at(line, cum, Math.min(cum[i] + 0.01, cum.at(-1)!))
    const right: XZ = [-t[1], t[0]]
    const cast = (dir: XZ) => {
      let m = Infinity
      for (const [a, b] of shore) {
        // Cheap reject: both ends far from the sample.
        if (Math.min(dist(p, a), dist(p, b)) > maxM + dist(a, b)) continue
        const h = hit(p, dir, a, b)
        if (h !== null && h < m) m = h
      }
      return m <= maxM ? m : null
    }
    return { left: cast([-right[0], -right[1]]), right: cast(right) }
  })
}

/**
 * Move each sample to the middle of the water (the mapped river line wanders
 * from bank to bank), then smooth so the game's line has no kinks.
 */
export function recentre(line: XZ[], edges: Array<{ left: number | null; right: number | null }>, smooth = 5): XZ[] {
  const cum = cumulative(line)
  const moved = line.map((p, i) => {
    const { left, right } = edges[i]
    if (left === null || right === null) return p
    const { t } = at(line, cum, Math.min(cum[i] + 0.01, cum.at(-1)!))
    const shift = (right - left) / 2
    return [p[0] - t[1] * shift, p[1] + t[0] * shift] as XZ
  })
  return moved.map((_, i) => {
    let x = 0
    let z = 0
    let n = 0
    for (let k = Math.max(0, i - smooth); k <= Math.min(moved.length - 1, i + smooth); k++) {
      x += moved[k][0]
      z += moved[k][1]
      n++
    }
    return [x / n, z / n] as XZ
  })
}

/** Where a polyline (a bridge deck, a lock gate) crosses the centreline, as distances along it. */
export function crossings(line: XZ[], cum: number[], way: XZ[]): number[] {
  const out: number[] = []
  for (let i = 0; i < line.length - 1; i++) {
    const d: XZ = [line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]]
    for (let j = 0; j < way.length - 1; j++) {
      const t = hit(line[i], d, way[j], way[j + 1])
      if (t !== null && t <= 1) out.push(cum[i] + t * (cum[i + 1] - cum[i]))
    }
  }
  return out
}
