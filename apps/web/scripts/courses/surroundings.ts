#!/usr/bin/env node
// The Reading game's surroundings: the ground, buildings and trees out to 1 km
// from the river (what the drone sees past the game's own land), from
// Environment Agency lidar (OGL v3) and OpenStreetMap's buildings (ODbL).
//
//   pnpm --filter web course:surroundings fetch [--dry]   the tiles and buildings it needs
//   pnpm --filter web course:surroundings build           games/reading-thames/surroundings/
//
// `fetch` downloads the EA's 250 m squares (DTM, first-return DSM, VOM) the 1 km
// band needs and doesn't have yet into ~/.paddlesnitch/lidar/reading-thames/tiles/
// (named as course:lidar reads them; they stay there, never commit them), and the
// band's buildings from Overpass (cached in .cache/courses/reading-thames/).
// `--dry` only counts. `build` writes one file per 500 m block (numbers worked
// out from them only) and an index. Pure parts in lib/surroundings.ts.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { projection, type XZ } from './lib/river'
import { mosaic, readTile, sampleGrid, wgs84ToBng, deriveTrees, deriveRoofs, ROOF, inside, LAND, type Grid, type Roof } from './lib/lidar'
import { BAND, INNER, SURROUND_BLOCK, SURROUND_CELL, CELL, COVERAGES, blockFile, blockKey, buildingsQuery, cellKind, coverageUrl, footprints, measureFootprint, middle, newFootprints, seamSink, tileName, tilesFor, type Footprint, type Kind } from './lib/surroundings'
import { courseFromFile, locate, pointAt, widthAt } from '../../../../games/reading-thames/course.js'
import { LIDAR } from '../../../../games/reading-thames/lidar.js'
import { groundAt } from '../../../../games/reading-thames/world.js'

const command = process.argv[2]
const dry = process.argv.includes('--dry')
if (command !== 'fetch' && command !== 'build') throw new Error('usage: course:surroundings fetch [--dry] | build')
const TILES = path.join(os.homedir(), '.paddlesnitch/lidar/reading-thames/tiles')
const CACHE = path.join(process.cwd(), '.cache/courses/reading-thames')
const GAME = path.join(process.cwd(), '../../games/reading-thames')
const data = JSON.parse(fs.readFileSync(path.join(GAME, 'courses/reading.json'), 'utf8'))
const course = courseFromFile(data)
const river = course.scenery.river
const { toXZ, toLatLng } = projection([51.46175, -0.96945])

// Game metres to the grid's: exact at each 250 m block's corners, straight between (as course:lidar).
const exact = (x: number, z: number) => wgs84ToBng(...toLatLng([x, z]))
const fits = new Map<string, { o: XZ; a: XZ; ex: XZ; ez: XZ }>()
const bng = (x: number, z: number): [number, number] => {
  const [bi, bj] = [Math.floor(x / 250), Math.floor(z / 250)]
  const key = `${bi},${bj}`
  let f = fits.get(key)
  if (!f) {
    const o: XZ = [bi * 250, bj * 250]
    const [a, b, c] = [exact(...o), exact(o[0] + 250, o[1]), exact(o[0], o[1] + 250)]
    f = { o, a, ex: [(b[0] - a[0]) / 250, (b[1] - a[1]) / 250], ez: [(c[0] - a[0]) / 250, (c[1] - a[1]) / 250] }
    fits.set(key, f)
  }
  const [dx, dz] = [x - f.o[0], z - f.o[1]]
  return [f.a[0] + f.ex[0] * dx + f.ez[0] * dz, f.a[1] + f.ex[1] * dx + f.ez[1] * dz]
}

// How far a point is from the water's edge (from the river line's nearest
// point, past its ends too), and how far inside the game's own land it is
// (realLand: strips out to INNER from the edge, between the river's ends).
const where = (x: number, z: number) => {
  const at = locate(river, x, z)
  const half = widthAt(river, at.s).half
  const edge = Math.hypot(x - at.x, z - at.z) - half
  // Along from the nearer end, inward (behind an end, how far behind it: negative).
  const ahead = (x - at.x) * at.tx + (z - at.z) * at.tz
  const end = at.s <= 0.01 ? Math.min(0, ahead) : at.s >= river.length - 0.01 ? Math.min(0, -ahead) : Math.min(at.s, river.length - at.s)
  return { edge, inside: Math.min(INNER - (Math.abs(at.lateral) - half), end), s: at.s }
}
const xs = river.samples.map((p: { x: number }) => p.x)
const zs = river.samples.map((p: { z: number }) => p.z)
const box = [Math.min(...xs) - BAND - 100, Math.min(...zs) - BAND - 100, Math.max(...xs) + BAND + 100, Math.max(...zs) + BAND + 100]

async function fetchAll() {
  // Every square under the band (with 40 m to spare, for the samples round a block's edge).
  const points: Array<[number, number]> = []
  for (let x = box[0]; x <= box[2]; x += 20) for (let z = box[1]; z <= box[3]; z += 20) if (where(x, z).edge <= BAND + 40) points.push(bng(x, z))
  const tiles = tilesFor(points)
  fs.mkdirSync(TILES, { recursive: true })
  const missing = (Object.keys(COVERAGES) as Kind[]).flatMap((kind) => tiles.filter((t) => !fs.existsSync(path.join(TILES, tileName(kind, t)))).map((t) => ({ kind, t })))
  console.log(`${tiles.length} squares under the band; ${missing.length} files to fetch (${new Set(missing.map((m) => m.t.join())).size} squares, about ${(missing.length * 0.26).toFixed(0)} MB)`)
  if (!dry) {
    let done = 0
    for (const { kind, t } of missing) {
      const res = await getWithRetry(coverageUrl(kind, t))
      const type = res.headers.get('content-type') ?? ''
      const buf = new Uint8Array(await res.arrayBuffer())
      // A refusal comes back as XML or a sign-in page: stop, don't keep asking.
      if (!type.startsWith('image/tiff') || !(buf[0] === 0x49 || buf[0] === 0x4d)) throw new Error(`the EA refused ${kind} ${t.join(',')}: ${res.status} ${type}`)
      readTile(buf) // (throws unless it's the float32 grid course:lidar reads)
      fs.writeFileSync(path.join(TILES, tileName(kind, t)), buf)
      if (++done % 20 === 0) console.log(`${done} of ${missing.length}`)
    }
  }
  // The buildings: everything within the band of the river line (Overpass's
  // `around` a polyline), points every 100 m.
  const file = path.join(CACHE, 'osm-surroundings.json')
  if (fs.existsSync(file)) return console.log(`${file}: cached`)
  if (dry) return console.log('buildings: not fetched (--dry)')
  const line = []
  for (let s = 0; s <= river.length; s += 100) { const p = pointAt(river, s); line.push(toLatLng([p.x, p.z])) }
  const body = await overpass(buildingsQuery(line, BAND + 60))
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(file, body)
  console.log(`${file}: ${JSON.parse(body).elements.length} buildings`)
}

// One request a second, and when the EA says too many (429), wait as long as
// it asks (or a minute) and go on: it rate-limits, and the lidar is free to use.
async function getWithRetry(url: string) {
  for (let attempt = 0; ; attempt++) {
    await new Promise((r) => setTimeout(r, 1000))
    const res = await fetch(url, { headers: { 'User-Agent': 'paddlesnitch course tools' } }).catch((e) => e as Error)
    if (!(res instanceof Error) && res.status < 500 && res.status !== 429) return res
    if (attempt === 5) throw new Error(`EA lidar: ${res instanceof Error ? res.message : res.status} after 6 tries`)
    const wait = res instanceof Error ? 0 : Number(res.headers.get('retry-after')) || 0
    console.log(`EA lidar: ${res instanceof Error ? res.message : res.status}, waiting ${wait || 60} s`)
    await new Promise((r) => setTimeout(r, (wait || 60) * 1000))
  }
}

// Overpass mirrors refuse often (406/502/504); try each a few times (as course:river).
const MIRRORS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
async function overpass(query: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of MIRRORS) {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'User-Agent': 'Mozilla/5.0 paddlesnitch' } }).catch(() => null)
      const body = res?.ok ? await res.text() : ''
      if (body.startsWith('{')) return body
    }
  }
  throw new Error('Overpass refused the buildings query on every mirror; try again later')
}

function build() {
  const grid = (kind: string): Grid => mosaic(fs.readdirSync(TILES).flatMap((name) => {
    const m = name.match(new RegExp(`^${kind}-(\\d+)-(\\d+)\\.tif$`))
    if (!m) return []
    return [{ west: Number(m[1]), south: Number(m[2]), ...readTile(fs.readFileSync(path.join(TILES, name))) }]
  }))
  const [dtm, dsm, vom] = [grid('dtm'), grid('dsm'), grid('vom')]
  // The pound's water, as course:lidar measures it.
  const water = sampleGrid(dsm, ...bng(-600, -480))!
  const ground = (x: number, z: number) => { const v = sampleGrid(dtm, ...bng(x, z)); return v === null ? null : v - water }
  const surface = (x: number, z: number) => { const v = sampleGrid(dsm, ...bng(x, z)); return v === null ? null : v - water }
  const canopy = (x: number, z: number) => sampleGrid(vom, ...bng(x, z))

  const osm = JSON.parse(fs.readFileSync(path.join(CACHE, 'osm-surroundings.json'), 'utf8')).elements
  const all = footprints(osm, toXZ).filter((f) => where(...middle(f.shape)).edge <= BAND)
  const known = data.buildings as Array<{ shape: XZ[] }>
  const fresh = newFootprints(all, known)
  console.log(`${all.length} buildings in the band, ${fresh.length} the game doesn't draw yet`)
  const byBlock = new Map<string, Array<Footprint & { ground: number; base: number; height: number }>>()
  for (const f of fresh) {
    const m = measureFootprint(f, ground, surface)
    if (!m) continue
    const k = blockKey(...middle(f.shape))
    if (!byBlock.has(k)) byBlock.set(k, [])
    byBlock.get(k)!.push({ ...f, ...m })
  }
  // Their roofs, fitted to the lidar as lidar.js's are (lib/lidar.ts deriveRoofs:
  // each footprint slid onto the lidar's building first, then the roof shaped).
  const measured = [...byBlock.values()].flat()
  const fit = deriveRoofs({ ground, above: (x, z) => { const [s, g] = [surface(x, z), ground(x, z)]; return s === null || g === null ? null : s - g } },
    measured, [box[0], box[1], box[2], box[3]], (x, z) => ground(x, z) ?? 0)
  const roofOf = new Map(fit.roofs.map((r) => [`${r[0]},${r[1]}`, r]))
  for (const b of measured) { const [cx, cz] = middle(b.shape); (b as { roof?: Roof }).roof = roofOf.get(`${Math.round(cx * 10) / 10},${Math.round(cz * 10) / 10}`) }
  const forms = fit.roofs.reduce<Record<string, number>>((a, r) => { const k = Array.isArray(r[3]) ? (r.length > 5 ? 'parts' : (r[4] as string[])[0]) : (r[2] as string); a[k] = (a[k] ?? 0) + 1; return a }, {})
  const rms = fit.errors.flatMap((e) => (e ? [e.rms] : [])).sort((a, b) => a - b)
  console.log(`roofs: ${JSON.stringify(forms)}; within ${ROOF.TAU} m, RMS median ${rms[rms.length >> 1]?.toFixed(2)} m, 90% under ${rms[Math.floor(rms.length * 0.9)]?.toFixed(2)} m`)
  // Where lidar.js already plants the trees (course:lidar's rule: by height,
  // so far from the water), and its trees, to keep clear of.
  const feet = [...fresh, ...known].map(({ shape }) => ({ shape, box: [Math.min(...shape.map((p) => p[0])), Math.min(...shape.map((p) => p[1])), Math.max(...shape.map((p) => p[0])), Math.max(...shape.map((p) => p[1]))] }))
  const lidarBlocks = new Set(Object.keys(LIDAR.ground.blocks))
  const inLidar = (x: number, z: number) => lidarBlocks.has(`${Math.floor(x / 250)},${Math.floor(z / 250)}`)
  const planted = new Map<string, Array<[number, number, number]>>()
  for (const t of LIDAR.trees as Array<[number, number, number]>) { const k = `${Math.floor(t[0] / 20)},${Math.floor(t[1] / 20)}`; if (!planted.has(k)) planted.set(k, []); planted.get(k)!.push(t) }
  const nearPlanted = (x: number, z: number, r: number) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const t of planted.get(`${Math.floor(x / 20) + a},${Math.floor(z / 20) + b}`) ?? []) if (Math.hypot(t[0] - x, t[1] - z) < r) return true
    return false
  }
  // (Outside lidar.js's blocks the game's own land plants made-up trees: none there either.)
  const lidarTree = (x: number, z: number, h: number) => (inLidar(x, z) ? where(x, z).edge <= (h >= 12 ? 120 : h >= 8 ? 70 : 40) : where(x, z).inside > 0)

  const out = path.join(GAME, 'surroundings')
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out)
  const n = SURROUND_BLOCK / SURROUND_CELL + 1
  const index: Array<[number, number]> = []
  let [nb, nt, bytes] = [0, 0, 0]
  for (let i = Math.floor(box[0] / SURROUND_BLOCK); i * SURROUND_BLOCK < box[2]; i++) for (let j = Math.floor(box[1] / SURROUND_BLOCK); j * SURROUND_BLOCK < box[3]; j++) {
    const [x0, z0] = [i * SURROUND_BLOCK, j * SURROUND_BLOCK]
    // The ground every SURROUND_CELL m: the median of the lidar's round each
    // point, lowered where it runs under the game's land (seamSink).
    const heights = new Float32Array(n * n)
    const info = Array.from({ length: n * n }, (_, k) => where(x0 + (k % n) * SURROUND_CELL, z0 + Math.floor(k / n) * SURROUND_CELL))
    if (!info.some((w) => w.edge <= BAND)) continue
    for (let k = 0; k < n * n; k++) {
      const [x, z] = [x0 + (k % n) * SURROUND_CELL, z0 + Math.floor(k / n) * SURROUND_CELL]
      const vs: number[] = []
      for (let a = -4; a <= 4; a += 2) for (let b = -4; b <= 4; b += 2) { const v = ground(x + a, z + b); if (v !== null) vs.push(v) }
      vs.sort((p, q) => p - q)
      const g = vs.length ? vs[Math.floor(vs.length / 2)] : 0
      // The lidar's water (a lake, the river past the locks): flat, just under the game's.
      // Towards the game's land, eased to a metre under it: past lidar.js's
      // blocks it's eased into made-up ground, metres off the lidar, and the true
      // hill poked through it or stood a step below its edge.
      const t = seamSink(info[k].inside)
      const under = t > 0 ? groundAt(course, x, z) - 1 : g
      heights[k] = g <= LAND ? -0.3 : g + (under - g) * t
    }
    // Each cell's kind, from 25 samples in it.
    const cells = new Uint8Array((n - 1) * (n - 1))
    const footIn = byBlock.get(`${i},${j}`) ?? []
    // Every footprint over the block, as a metre grid (a footprint is looked for millions of times).
    const built = new Uint8Array(SURROUND_BLOCK * SURROUND_BLOCK)
    for (const { shape, box: [a, b, c, d] } of feet) {
      if (c < x0 || a > x0 + SURROUND_BLOCK || d < z0 || b > z0 + SURROUND_BLOCK) continue
      for (let x = Math.max(x0, Math.floor(a)); x <= Math.min(x0 + SURROUND_BLOCK - 1, c); x++) for (let z = Math.max(z0, Math.floor(b)); z <= Math.min(z0 + SURROUND_BLOCK - 1, d); z++) {
        if (inside(shape, x + 0.5, z + 0.5)) built[(z - z0) * SURROUND_BLOCK + (x - x0)] = 1
      }
    }
    const onBuilding = (x: number, z: number) => { const [u, v] = [Math.floor(x - x0), Math.floor(z - z0)]; return u >= 0 && v >= 0 && u < SURROUND_BLOCK && v < SURROUND_BLOCK && built[v * SURROUND_BLOCK + u] === 1 }
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
      const corners = [info[r * n + c], info[r * n + c + 1], info[(r + 1) * n + c], info[(r + 1) * n + c + 1]]
      // Not drawn: past the band, or well inside the game's land (its last 30 m are drawn under it).
      const covered = corners.every((w) => w.inside > 30) || corners.every((w) => w.edge > BAND)
      let [tree, roofed, wet, seen] = [0, 0, 0, 0]
      for (let a = 1; a < 10; a += 2) for (let b = 1; b < 10; b += 2) {
        const [x, z] = [x0 + c * SURROUND_CELL + a, z0 + r * SURROUND_CELL + b]
        const g = ground(x, z)
        if (g === null) continue
        seen++
        if (g <= LAND) wet++
        if ((canopy(x, z) ?? 0) > 3) tree++
        if (onBuilding(x, z)) roofed++
      }
      cells[r * (n - 1) + c] = cellKind({ canopy: seen ? tree / seen : 0, built: seen ? roofed / seen : 0, wet: seen > 0 && wet * 2 > seen, covered: covered || !seen })
    }
    // Trees: the canopy's crowns (course:lidar's deriveTrees), on land, off
    // buildings, where lidar.js doesn't already plant them, within the band.
    const keepOut = onBuilding
    const dry = (x: number, z: number): XZ | null => ((ground(x, z) ?? 0) > LAND ? [x, z] : null)
    const trees = deriveTrees({ ground, above: canopy }, [x0, z0, x0 + SURROUND_BLOCK - 1, z0 + SURROUND_BLOCK - 1], keepOut, dry, () => 0)
      .filter(([x, z, h]) => where(x, z).edge <= BAND && !lidarTree(x, z, h) && !nearPlanted(x, z, Math.max(4, h * 0.3)))
    if (cells.every((k) => k === CELL.none) && !footIn.length && !trees.length) continue
    const text = blockFile({ i, j }, Array.from(heights, (v) => Math.round(v * 10)), cells, footIn, trees)
    fs.writeFileSync(path.join(out, `${i}_${j}.json`), text)
    index.push([i, j])
    nb += footIn.length
    nt += trees.length
    bytes += text.length
    console.log(`${i},${j}: ${footIn.length} buildings, ${trees.length} trees, ${(text.length / 1024).toFixed(0)} KB`)
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ block: SURROUND_BLOCK, blocks: index }))
  console.log(`${out}: ${index.length} blocks, ${nb} buildings, ${nt} trees, ${(bytes / 1024).toFixed(0)} KB`)
}

if (command === 'fetch') fetchAll().catch((e) => { console.error(e); process.exit(1) })
else build()
