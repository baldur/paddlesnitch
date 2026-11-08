// @vitest-environment node
// The map's portage markers and a portage's own page (packages/waterways/src/
// portage-page.ts): only public portage details ever reach them.
import fs from 'fs'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'
import { GET as mapData } from '@/app/plan/data/[version]/[name]/route'
import { areaKey, AREA_DEG } from '@paddlesnitch/waterways/display'
import { headingAt, lineThrough, nearestAlong, portageFacts, portagePointsInArea } from '@paddlesnitch/waterways/portage-page'
import { loadPortageFacts, loadPortagePoints } from '@paddlesnitch/waterways/portage-page-store'
import { addPendingPortage, addPortage, clearPortageCache, holdPortage } from '@paddlesnitch/waterways/portage-store'
import { portageBankLine } from '@/lib/plan-ui'
import type { PublicPortage } from '@paddlesnitch/waterways/portage'
import type { Feature, LatLng, NetLink } from '@paddlesnitch/waterways/types'

const NOTE = 'SECRETNOTE zzqx'
const MARSH: LatLng = [51.528627, -0.885527]
const MARSH_ID = 'ea-lock:marsh'
const TYLE_MILL = 'crt:locks:KA-013-009'
const key = (p: LatLng) => areaKey(Math.floor(p[0] / AREA_DEG), Math.floor(p[1] / AREA_DEG))
const fields = (featureId: string, at: LatLng) => ({ featureId, at, notes: NOTE, landings: [[at[0] + 0.0004, at[1] - 0.0004], [at[0] + 0.0004, at[1] + 0.0004]] as [LatLng, LatLng] })
const AT = '2026-01-01T00:00:00.000Z'
const lock = (id: string, at: LatLng, extra: Partial<Feature> = {}): Feature => ({ id, kind: 'lock', name: id, at, source: { source: 'crt', fetchedAt: AT }, ...extra })

const link = (id: string, from: string, to: string, line: LatLng[], extra: Partial<NetLink> = {}): NetLink => ({ id, name: id, form: 'inlandRiver', from, to, line, lengthM: 1000, ...extra })
const EAST: NetLink[] = [
  link('a', 'n1', 'n2', [[51, 0], [51, 0.01]]),
  link('b', 'n2', 'n3', [[51, 0.01], [51, 0.02]]),
  link('side', 'n2', 'n4', [[51, 0.01], [51.01, 0.01]]),
]

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); clearPortageCache() })
afterEach(async () => { await cleanDataDir(dataDir) })

describe('the water through a lock', () => {
  it('carries on the straightest way at a junction, not up the side branch', () => {
    const t = lineThrough(EAST, [51, 0.005], 5000)!
    expect(t.line.at(-1)).toEqual([51, 0.02])
    expect(t.waterways).toEqual(['a', 'b'])
  })
  it('prefers water you can paddle over a straighter line you can\'t', () => {
    const links = [EAST[0], { ...EAST[1], boat: 'no' as const }, EAST[2]]
    expect(lineThrough(links, [51, 0.005], 5000)!.line.at(-1)).toEqual([51.01, 0.01])
  })
  it('walks back as well as on', () => {
    const t = lineThrough(EAST, [51, 0.015], 5000)!
    expect(t.line[0]).toEqual([51, 0])
  })
  it('is nothing far from any water', () => expect(lineThrough(EAST, [55, 3], 5000)).toBeNull())
  it('names the heading', () => {
    expect(headingAt([[51, 0], [51, 0.01]], 300)).toBe('east')
    expect(headingAt([[51, 0.01], [51, 0]], 300)).toBe('west')
    expect(headingAt([[51, 0], [51.01, 0]], 300)).toBe('north')
  })
})

describe('both ways along the water', () => {
  const at: LatLng = [51, 0.005]
  const c: PublicPortage = { id: 'p1', name: 'Ann', at, featureId: 'l1', landings: [[51.0001, 0.0045], [51.0001, 0.0055]], licence: 'CC0-1.0', createdAt: AT, updatedAt: AT }
  const f = portageFacts(lock('l1', at), EAST, [c], 5000)

  it('gives opposite headings, with the landings swapped and the banks flipped', () => {
    const [there, back] = f.portages[0].ways
    expect([there.heading, back.heading].sort()).toEqual(['east', 'west'])
    expect(there.portage.takeOut.at).toEqual(back.portage.putIn.at)
    expect(there.portage.takeOut.bank).not.toBe(back.portage.putIn.bank)
    expect(portageBankLine(there.portage)).toMatch(/^Get out on the (left|right) bank/)
  })
  it('a lock nowhere near water still has a page, with no landings to draw', () => {
    expect(portageFacts(lock('x', [55, 3]), EAST, [], 5000)).toMatchObject({ line: [], portages: [] })
  })
})

describe('the map\'s markers', () => {
  const at: LatLng = [51.2, 0.2]
  const c = { id: 'p', featureId: 'known', at, landings: [at, at], hidden: undefined } as unknown as PublicPortage
  const k = key(at)

  it('shows a lock, known only when someone has described it', () => {
    const points = portagePointsInArea([lock('known', at), lock('unknown', [at[0] + 0.01, at[1]])], [c], k)
    expect(points.map(p => [p.id, p.known])).toEqual([['known', true], ['unknown', false]])
  })
  it('a lock you paddle through counts as known', () => {
    expect(portagePointsInArea([lock('u', at, { noCarry: true })], [], k)[0].known).toBe(true)
  })
  it('a weir shows only once someone described a carry', () => {
    const weir = lock('known', at, { kind: 'weir' })
    expect(portagePointsInArea([weir], [], k)).toEqual([])
    expect(portagePointsInArea([weir], [c], k)).toHaveLength(1)
  })
  it('only what\'s in the area', () => expect(portagePointsInArea([lock('far', [40, 10])], [], k)).toEqual([]))
  it('leaves out other kinds', () => expect(portagePointsInArea([lock('s', at, { kind: 'slipway' })], [], k)).toEqual([]))
  it('come from the data route, briefly cached because they move with contributions', async () => {
    const name = `portages-${key(MARSH)}`
    const res = await mapData(new Request(`http://x/plan/data/none/${name}`), { params: Promise.resolve({ version: 'none', name }) })
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect(JSON.stringify(await res.json())).toContain('Marsh Lock')
  })
})

describe('what a portage\'s page and markers may show', () => {
  const body = async (id: string) => JSON.stringify(await loadPortageFacts(id))
  const add = async () => { const u = await makeUser('Ann'); return addPendingPortage({ id: u.id, name: u.displayName }, fields(MARSH_ID, MARSH)) }
  const marshKnown = async () => (await loadPortagePoints(key(MARSH))).find(p => p.id === MARSH_ID)?.known

  it('a published note is on the page, and fills the marker', async () => {
    const u = await makeUser('Ann')
    await addPortage({ id: u.id, name: 'Ann' }, fields(MARSH_ID, MARSH))
    clearPortageCache()
    expect(await body(MARSH_ID)).toContain(NOTE)
    expect(await marshKnown()).toBe(true)
  })
  it('a pending note isn\'t, and leaves the marker hollow', async () => {
    await add()
    clearPortageCache()
    expect(await body(MARSH_ID)).not.toContain(NOTE)
    expect(await marshKnown()).toBe(false)
  })
  it('a held note isn\'t, and neither is its ref', async () => {
    const c = await add()
    const held = await holdPortage(c.id, { category: 'rude' })
    clearPortageCache()
    const page = await body(MARSH_ID)
    expect(page).not.toContain(NOTE)
    expect(page).not.toContain(held!.reviewRef!)
    expect(await marshKnown()).toBe(false)
  })
  it('the page\'s only way to portage details is the public loader', () => {
    const src = fs.readFileSync(path.join(__dirname, '../app/plan/portage/[id]/page.tsx'), 'utf8')
    expect(src).toContain('loadPortageFacts')
    expect(src).not.toMatch(/portage-store|getPublicPortage|getPendingPortage/)
    const store = fs.readFileSync(path.join(__dirname, '../../../../packages/waterways/src/portage-page-store.ts'), 'utf8')
    expect(store).toMatch(/listPublicPortages/)
    expect(store).not.toMatch(/getPublicPortage|getPendingPortage|listPendingPortages|listMyPortages/)
  })
  it('a surveyed carry comes with its banks, level and credit', async () => {
    const f = (await loadPortageFacts(TYLE_MILL))!
    expect(f.name).toContain('Tyle Mill')
    const c = f.portages[0].ways[0].portage
    expect(c.notes).toContain('Environment Agency gauge')
    expect(c.by).toBe('paddlesnitch survey')
  })
  it('an unknown id, or something that isn\'t a portage, has no page', async () => {
    expect(await loadPortageFacts('no-such-lock')).toBeNull()
  })
})

describe('the nearest gauge', () => {
  it('is nearest along the water', () => {
    expect(nearestAlong([{ chainageM: 900, n: 'a' }, { chainageM: 100, n: 'b' }], 300)?.n).toBe('b')
    expect(nearestAlong([], 300)).toBeUndefined()
  })
})
