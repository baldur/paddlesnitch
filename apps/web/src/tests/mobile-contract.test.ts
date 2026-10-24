// @vitest-environment node
// The mobile apps' contract (docs/features/mobile-apps.md, phase C1): the
// committed mobile/contract/ files must be what `pnpm mobile:contract` would
// write now, every listed procedure must exist with the stated kind, and real
// answers from the router must fit the schemas the apps are generated from.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter, createCaller } from '@paddlesnitch/api'
import { contractProcedures, Me, PaddleList, AnalysisSession } from '@paddlesnitch/api/contract'
import type { z } from 'zod'
import { analyseTrack } from '@paddlesnitch/analysis/analysis'
import { mobileContractFiles, tokensFromCss } from '@/lib/mobile-contract'

const ROOT = path.resolve(__dirname, '../../../..')
const CONTRACT = path.join(ROOT, 'mobile/contract')
const tokensCss = readFileSync(path.join(ROOT, 'packages/ui/src/tokens.css'), 'utf8')

function committed(dir: string): string[] {
  const full = path.join(CONTRACT, dir)
  return existsSync(full) ? readdirSync(full).map(f => `${dir}/${f}`) : []
}

describe('mobile/contract is up to date', () => {
  const generated = mobileContractFiles(tokensCss)

  it('has exactly the generated files, with the generated content (run pnpm mobile:contract)', () => {
    expect([...committed('api'), ...committed('tokens')].sort()).toEqual(Object.keys(generated).sort())
    for (const [name, content] of Object.entries(generated)) {
      expect(readFileSync(path.join(CONTRACT, name), 'utf8'), name).toBe(content)
    }
  })

  it('lets the server add fields: no schema forbids unnamed properties', () => {
    for (const [name, content] of Object.entries(generated)) expect(content, name).not.toContain('additionalProperties')
  })
})

describe('contract procedures', () => {
  const procedures = (appRouter._def as unknown as { procedures: Record<string, { _def: { type: string } }> }).procedures

  it('names only procedures the router has, with the same kind', () => {
    for (const [p, c] of Object.entries(contractProcedures)) {
      expect(procedures[p], p).toBeDefined()
      expect(procedures[p]._def.type, p).toBe(c.kind)
    }
  })
})

describe('tokensFromCss', () => {
  it('reads colours, pixel radii and the first quoted font family', () => {
    const t = tokensFromCss(`@theme inline {
      --font-sans: var(--font-plex-sans), "IBM Plex Sans", system-ui, sans-serif;
      --radius-control: 6px;
      --color-bg: #0b1220;        /* light: #ffffff */
      --color-surface-2: #1e293b;
    }`)
    expect(t).toEqual({
      color: { bg: '#0b1220', 'surface-2': '#1e293b' },
      radius: { control: 6 },
      font: { sans: 'IBM Plex Sans' },
    })
  })

  it('finds the platform background and primary in the real tokens', () => {
    const t = tokensFromCss(tokensCss)
    expect(t.color.bg).toMatch(/^#[0-9a-f]{6}$/)
    expect(t.color.primary).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('real answers fit the schemas', () => {
  const USER = { id: 'user-1', email: 'p@example.com', displayName: 'Pat' }
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-contract-'))
    process.env.USE_LOCAL_STORAGE = 'true'
    process.env.DATA_DIR = dir
  })
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); delete process.env.DATA_DIR })

  // A real analysed paddle: 10 minutes at ~3 m/s with a stroke rate.
  async function savePaddle(id: string) {
    const t0 = Date.parse('2026-09-01T10:00:00Z')
    const track = Array.from({ length: 600 }, (_, i) => ({
      lat: 51.5 + i * 0.000027, lng: -0.9, timestamp: new Date(t0 + i * 1000), strokeRate: 60 + (i % 5),
    }))
    const result = analyseTrack(track)
    const session = {
      id, userId: USER.id, createdAt: '2026-09-01T11:00:00.000Z', paddledAt: '2026-09-01T10:00:00.000Z',
      source: { type: 'file', filename: 'river.gpx' }, doubleStrokeRate: false, note: 'windy', insight: result.insight,
      result, boatClass: 'K1', seat: 1,
    }
    const p = path.join(dir, 'analysis', USER.id, id)
    await fs.mkdir(p, { recursive: true })
    await fs.writeFile(path.join(p, 'session.json'), JSON.stringify(session))
  }

  it('me, signed in and signed out', async () => {
    expect(Me.safeParse(await createCaller({ user: USER }).me()).success).toBe(true)
    expect(Me.safeParse(await createCaller({ user: null }).me()).success).toBe(true)
  })

  it('paddles.list and paddles.get for an analysed paddle', async () => {
    await savePaddle('aaa')
    const caller = createCaller({ user: USER })
    const list = PaddleList.safeParse(await caller.paddles.list())
    expect(list.error?.issues).toBeUndefined()
    const one = AnalysisSession.safeParse(await caller.paddles.get({ id: 'aaa' }))
    expect(one.error?.issues).toBeUndefined()
  })
})

// mobile/contract/README.md promises the apps this exact wire format.
describe('the HTTP form the apps speak', () => {
  const USER = { id: 'user-1', email: 'p@example.com', displayName: 'Pat' }
  const call = (url: string, user: typeof USER | null) => fetchRequestHandler({
    endpoint: '/api/trpc', req: new Request(`https://paddlesnitch.com${url}`), router: appRouter,
    createContext: async () => ({ user }),
  })

  it('a query without input: GET, answer under result.data', async () => {
    const res = await call('/api/trpc/me', USER)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: { data: { user: USER } } })
  })

  it('a query with input: ?input=<url-encoded JSON>; errors carry data.code', async () => {
    const res = await call(`/api/trpc/paddles.get?input=${encodeURIComponent(JSON.stringify({ id: 'nope' }))}`, USER)
    expect(res.status).toBe(404)
    expect((await res.json()).error.data.code).toBe('NOT_FOUND')
  })

  it('signed out: 401 UNAUTHORIZED', async () => {
    const res = await call('/api/trpc/paddles.list', null)
    expect(res.status).toBe(401)
    expect((await res.json()).error.data.code).toBe('UNAUTHORIZED')
  })
})

// The golden answers both apps decode in their own tests.
describe('fixtures/api', () => {
  const fixture = (name: string) => JSON.parse(readFileSync(path.join(CONTRACT, 'fixtures/api', name), 'utf8'))
  const schemaFor: Record<string, z.ZodType> = { me: Me, 'paddles.list': PaddleList, 'paddles.get': AnalysisSession }
  const names = readdirSync(path.join(CONTRACT, 'fixtures/api')).filter(f => !f.includes('unknown-values'))

  it.each(names)('%s fits its procedure\'s output schema', name => {
    // <procedure>[.<case>].json — the longest procedure path the name starts with.
    const procedure = Object.keys(schemaFor).filter(p => name.startsWith(`${p}.`)).sort((a, b) => b.length - a.length)[0]
    const schema = schemaFor[procedure]
    expect(schema, `no schema for ${name}`).toBeDefined()
    expect(schema.safeParse(fixture(name)).error?.issues).toBeUndefined()
  })

  it('covers every contract procedure', () => {
    for (const p of Object.keys(contractProcedures)) expect(names.some(n => n.startsWith(`${p}.`)), p).toBe(true)
  })

  // A newer server may add a value to any closed set. The apps must decode
  // these to an "unknown" case; the schema itself should object at exactly
  // those places and nowhere else (an extra field is never an issue).
  it('unknown-values breaks the schema only at the new enum values and union kind', () => {
    const issues = AnalysisSession.safeParse(fixture('paddles.get.unknown-values.json')).error?.issues ?? []
    expect([...new Set(issues.map(i => i.path.slice(0, 4).join('.')))].sort()).toEqual([
      'boatClass', 'result.noGps.reason.kind', 'result.stops.0.kind', 'source.type',
    ])
  })
})

describe('schema rules the app generators rely on', () => {
  const schemas = Object.entries(mobileContractFiles(tokensCss)).filter(([n]) => n.endsWith('.schema.json'))
  const walk = (node: unknown, visit: (n: Record<string, unknown>) => void) => {
    if (node && typeof node === 'object') {
      visit(node as Record<string, unknown>)
      for (const v of Object.values(node)) walk(v, visit)
    }
  }

  it('every oneOf variant is an object with a `kind` constant', () => {
    for (const [name, content] of schemas) walk(JSON.parse(content), n => {
      if (!Array.isArray(n.oneOf)) return
      for (const v of n.oneOf as { properties?: { kind?: { const?: unknown } } }[]) {
        expect(typeof v.properties?.kind?.const, name).toBe('string')
      }
    })
  })

  it('timestamps are date-time and counts are integers', () => {
    const get = (n: string) => JSON.parse(schemas.find(([f]) => f === `api/${n}.schema.json`)![1])
    expect(get('AnalysisSession').properties.paddledAt.format).toBe('date-time')
    expect(get('PaddleTotals').properties.count.type).toBe('integer')
  })
})
