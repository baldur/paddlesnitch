// @vitest-environment node
// The map's portage markers and a portage's own page (packages/waterways/src/
// portage-page.ts): only public portage details ever reach them.
import fs from 'fs'
import path from 'path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'
import { GET as mapData } from '@/app/plan/data/[version]/[name]/route'
import { areaKey, AREA_DEG } from '@paddlesnitch/waterways/display'
import { ageText, decodePortageId, gaugeSourceCovers, headingAt, lineThrough, nearestAlong, portageCredits, portageFacts, portagePointsInArea, realWaterways, shortPlaceName } from '@paddlesnitch/waterways/portage-page'
import { clearLevelOutage, loadGaugeNear, loadPortageFacts, loadPortagePoints } from '@paddlesnitch/waterways/portage-page-store'
import { clearLiveCaches } from '@paddlesnitch/waterways/live-store'
import { addPendingPortage, addPortage, clearPortageCache, flagPortage, holdPortage } from '@paddlesnitch/waterways/portage-store'
import { portagePageHref, portageWayLine, safeBack } from '@/lib/plan-ui'
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
beforeEach(async () => { dataDir = await makeDataDir(); clearPortageCache(); clearLevelOutage(); clearLiveCaches() })
afterEach(async () => { await cleanDataDir(dataDir); vi.unstubAllGlobals() })

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

  it('swaps the landings and flips the sides each way', () => {
    const [there, back] = f.portages[0].ways
    expect(there.portage.takeOut.at).toEqual(back.portage.putIn.at)
    expect(there.portage.takeOut.bank).not.toBe(back.portage.putIn.bank)
    expect(portageWayLine(there.portage)).toMatch(/^get out on your (left|right)\. Back in about \d+ m further on\.$/)
  })
  it('names each way by the next lock along the water, then a town, then a compass point', () => {
    const next = portageFacts(lock('l1', at), EAST, [c], 5000, [{ name: 'Lock 7, Far Lock', at: [51, 0.015] }], [{ name: 'Westham', at: [51, 0.001] }])
    expect(next.portages[0].ways.map(w => w.towards)).toEqual(['Far Lock', 'Westham'])
    expect(f.portages[0].ways.map(w => w.towards)).toEqual(['the east', 'the west'])
  })
  it('says when the two landings are on different sides', () => {
    expect(portageWayLine({ takeOut: { at, bank: 'right' }, putIn: { at, bank: 'left' }, carryM: 90 })).toBe('get out on your right. Back in on your left, about 90 m further on.')
  })
  it('a lock nowhere near water still has a page, with no landings to draw', () => {
    expect(portageFacts(lock('x', [55, 3]), EAST, [], 5000)).toMatchObject({ line: [], portages: [] })
  })
})

describe('the map\'s markers', () => {
  const at: LatLng = [51.2, 0.2]
  const c = { id: 'p', featureId: 'known', at, landings: [at, at], hidden: undefined } as unknown as PublicPortage
  const k = key(at)

  it('shows a lock, marked landings only when someone has described them', () => {
    const points = portagePointsInArea([lock('known', at), lock('unknown', [at[0] + 0.01, at[1]])], [c], k)
    expect(points.map(p => [p.id, p.state])).toEqual([['known', 'landings'], ['unknown', 'unknown']])
  })
  it('a lock you paddle through is marked so, never as described', () => {
    expect(portagePointsInArea([lock('u', at, { noCarry: true })], [], k)[0].state).toBe('no_carry')
  })
  it('a side from a dataset alone isn\'t described landings', () => {
    expect(portagePointsInArea([lock('s', at, { portage: { side: 'left' } })], [], k)[0].state).toBe('unknown')
  })
  it('a weir shows only once someone described a carry', () => {
    const weir = lock('known', at, { kind: 'weir' })
    expect(portagePointsInArea([weir], [], k)).toEqual([])
    expect(portagePointsInArea([weir], [c], k)).toHaveLength(1)
  })
  it('only what\'s in the area', () => expect(portagePointsInArea([lock('far', [40, 10])], [], k)).toEqual([]))
  it('leaves out other kinds', () => expect(portagePointsInArea([lock('s', at, { kind: 'slipway' })], [], k)).toEqual([]))
  it('come from the data route with a 5-minute cache', async () => {
    const name = `portages-${key(MARSH)}`
    const res = await mapData(new Request(`http://x/plan/data/none/${name}`), { params: Promise.resolve({ version: 'none', name }) })
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect(JSON.stringify(await res.json())).toContain('Marsh Lock')
  })
})

describe('what a portage\'s page and markers may show', () => {
  const body = async (id: string) => JSON.stringify(await loadPortageFacts(id))
  const add = async () => { const u = await makeUser('Ann'); return addPendingPortage({ id: u.id, name: u.displayName }, fields(MARSH_ID, MARSH)) }
  const marshKnown = async () => (await loadPortagePoints(key(MARSH))).find(p => p.id === MARSH_ID)?.state === 'landings'

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
  it('the page\'s source imports the public loader and none of the private ones', () => {
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
  it('an unknown id has no page', async () => {
    expect(await loadPortageFacts('no-such-lock')).toBeNull()
  })
  it('a feature that isn\'t a portage has no page', async () => {
    const ds = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../packages/waterways/data/dw.json'), 'utf8')) as { features: Feature[] }
    expect(await loadPortageFacts(ds.features.find(f => f.kind === 'crew_point')!.id)).toBeNull()
  })
  it('a published note hidden by flags comes off the page and the marker', async () => {
    const u = await makeUser('Ann')
    const c = await addPortage({ id: u.id, name: 'Ann' }, fields(MARSH_ID, MARSH))
    for (const n of ['F1', 'F2', 'F3']) await flagPortage((await makeUser(n)).id, c.id)
    clearPortageCache()
    expect(await body(MARSH_ID)).not.toContain(NOTE)
    expect(await marshKnown()).toBe(false)
  })
  it('names real waterways only', async () => {
    expect(realWaterways(['Kennet and Avon Canal', 'Lock 50 (Top Lock)', 'Weir Stream', 'River Lock'])).toEqual(['Kennet and Avon Canal', 'River Lock'])
  })
})

describe('the address', () => {
  it('bad percent-encoding is no id, not a crash', () => expect(decodePortageId('%E0%A4%A')).toBeNull())
  it('an id with a slash survives the round trip', () => {
    const href = portagePageHref('osm:lock:way/123')
    expect(href).toBe('/plan/portage/osm%3Alock%3Away%2F123')
    expect(decodePortageId(href.split('/').pop()!)).toBe('osm:lock:way/123')
  })
  it('the way back is only ever a plan here', () => {
    expect(safeBack('/plan?from=51,-1&to=52,-1')).toBe('/plan?from=51,-1&to=52,-1')
    expect(safeBack('/plan/abc123')).toBe('/plan/abc123')
    for (const bad of ['https://evil.example', '//evil.example', '/plan/../account', '/plan\\evil', '/account', undefined, ['/plan']]) expect(safeBack(bad as never)).toBe('/plan')
  })
  it('carries the plan to come back to', () => {
    expect(portagePageHref('a', '/plan?x=1')).toBe('/plan/portage/a?back=%2Fplan%3Fx%3D1')
  })
  it('the page answers bad encoding with not-found metadata', async () => {
    const { generateMetadata } = await import('@/app/plan/portage/[id]/page')
    expect(await generateMetadata({ params: Promise.resolve({ id: '%E0%A4%A' }) })).toEqual({ title: 'Portage not found' })
  })
})

describe('credits', () => {
  const base = { feature: lock('x', [51, 0]), line: [[51, 0], [51, 0.01]] as LatLng[] }
  it('name the feature\'s source, the water and the gauge', () => {
    expect(portageCredits(base, 'ea')).toEqual(['Details from Canal & River Trust open data.', 'Water: © OpenStreetMap contributors.', 'River level: Environment Agency.'])
  })
  it('credit a survey as ours', () => {
    expect(portageCredits({ ...base, feature: lock('s', [51, 0], { source: { source: 'curated', fetchedAt: AT } }) })[0]).toBe('Details from a paddlesnitch survey.')
  })
  it('leave out the water when none is drawn, and the gauge when there is none', () => {
    expect(portageCredits({ ...base, line: [] })).toEqual(['Details from Canal & River Trust open data.'])
  })
})

describe('the nearest gauge\'s reading', () => {
  const ENGLAND: LatLng = [51.43, -1.05]
  const facts = { feature: lock('x', ENGLAND), line: [ENGLAND, [51.44, -1.04]] as LatLng[], waterways: ['River Kennet'], alongM: 100, name: 'x', portages: [] }

  it('all sources failing says it couldn\'t read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect(await loadGaugeNear(facts)).toEqual({ unavailable: true })
  })
  it('a source that hangs past the limit gives up rather than hold the page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const t = Date.now()
    expect(await loadGaugeNear(facts, 30)).toEqual({ unavailable: true })
    expect(Date.now() - t).toBeLessThan(1000)
  })
  it('after an outage it says so at once, without asking again', async () => {
    const f = vi.fn(async () => { throw new Error('down') })
    vi.stubGlobal('fetch', f)
    await loadGaugeNear(facts)
    const asked = f.mock.calls.length
    await loadGaugeNear(facts)
    expect(f.mock.calls.length).toBe(asked)
  })
  it('a slow answer isn\'t an outage: the next page asks again', async () => {
    const f = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', f)
    await loadGaugeNear(facts, 30)
    clearLiveCaches()      // the hung request is cached; a real one ends
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], features: [] }))))
    const near = await loadGaugeNear(facts, 2000)
    expect(near.gauge).toBeUndefined()
    expect(near.unavailable).toBeDefined()
  })
  it('an outage only counts where that source covers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    await loadGaugeNear(facts)
    const inSweden = { ...facts, feature: lock('s', [59.3, 18.0]), line: [[59.3, 18.0], [59.31, 18.0]] as LatLng[] }
    clearLiveCaches()
    const answered = vi.fn(async (u: string) => (String(u).includes('smhi') ? new Response(JSON.stringify({ station: [] })) : new Response('{}', { status: 500 })))
    vi.stubGlobal('fetch', answered)
    clearLevelOutage()
    await loadGaugeNear(facts)                       // England's sources fail
    const asked = answered.mock.calls.length
    await loadGaugeNear(inSweden)
    expect(answered.mock.calls.length).toBeGreaterThanOrEqual(asked)
    expect((await loadGaugeNear(facts)).unavailable).toBe(true)
  })
  it('a failure somewhere else doesn\'t count here', () => {
    expect(gaugeSourceCovers('SMHI', ENGLAND)).toBe(false)
    expect(gaugeSourceCovers('Rijkswaterstaat', ENGLAND)).toBe(false)
    expect(gaugeSourceCovers('Environment Agency', ENGLAND)).toBe(true)
  })
  it('no gauge and a far-off source down is just no gauge', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      if (String(u).includes('environment.data.gov.uk') || String(u).includes('sepa') || String(u).includes('waterlevel.ie')) return new Response(JSON.stringify({ items: [], features: [] }))
      throw new Error('down')
    }))
    const near = await loadGaugeNear(facts)
    expect(near.gauge).toBeUndefined()
    expect(near.unavailable).toBe(false)
  })
  it('says how old a reading is', () => {
    expect(ageText(40)).toBe('40 minutes')
    expect(ageText(1)).toBe('1 minute')
    expect(ageText(180)).toBe('3 hours')
    expect(ageText(60 * 72)).toBe('3 days')
  })
  it('shortens a lock\'s name for a sentence', () => {
    expect(shortPlaceName('Lock 100, Sulhamstead Lock')).toBe('Sulhamstead Lock')
    expect(shortPlaceName('Ufton Lock: no carry unless the river is very high')).toBe('Ufton Lock')
  })
})

describe('the nearest gauge', () => {
  it('is nearest along the water', () => {
    expect(nearestAlong([{ chainageM: 900, n: 'a' }, { chainageM: 100, n: 'b' }], 300)?.n).toBe('b')
    expect(nearestAlong([], 300)).toBeUndefined()
  })
})
