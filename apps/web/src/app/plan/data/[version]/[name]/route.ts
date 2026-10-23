// What the planner's map draws, from the live national dataset
// (docs/features/waterways-uk-ireland.md): `overview` (the whole network,
// coarsely), `area-{y}_{x}` (one 0.5° area in detail), `openportage` (paddlers' portage details, CC0), `needed`
// (locks with no portage details, most-planned first), `tides-nl` (Rijkswaterstaat's predicted Dutch high and
// low waters, fetched at build time), and coverage by waterway: `coverage` (the scores, for
// /plan/gaps) and `coverage-lines` (how many chunks of scored water each level has) with
// `coverage-lines-{good|some|thin}-{i}` (the chunks, for the map: in one response it was
// over Lambda's 6 MB limit with Germany). The version is in the URL, so a response for the live version
// never changes and can be cached for good (by CloudFront too: /plan/data/* honours these headers), except
// coverage and `needed`, which move as paddlers add portages and plans.
import { areaLines, overviewLines } from '@paddlesnitch/waterways/display'
import { loadCoverage, loadNational, loadNeeded, loadOfficialTides } from '@paddlesnitch/waterways/national'
import { listPublicPortages } from '@paddlesnitch/waterways/portage-store'
import { chunkLines, coverageLines } from '@paddlesnitch/waterways/waterway-coverage'
import type { LatLng } from '@paddlesnitch/waterways/types'

export const dynamic = 'force-dynamic'

let overview: { version: string; lines: unknown } | null = null
let covLines: { rows: unknown; chunks: Record<'good' | 'some' | 'thin', LatLng[][][]> } | null = null
/** Each coverage-lines chunk's JSON at most this: well under Lambda's 6 MB. */
const CHUNK_BYTES = 2_000_000

export async function GET(_req: Request, { params }: { params: Promise<{ version: string; name: string }> }) {
  const { version, name } = await params
  // OpenPortage: every visible contribution, CC0, for anyone to reuse. Not
  // tied to a dataset version, and it changes as people add to it.
  if (name === 'openportage') {
    const all = (await listPublicPortages()).filter(p => !p.hidden)
    return Response.json({ licence: 'CC0-1.0', about: 'https://paddlesnitch.com/plan/gaps', count: all.length, portages: all },
      { headers: { 'Cache-Control': 'public, max-age=300' } })
  }
  const ds = await loadNational()
  const area = /^area-(-?\d+_-?\d+)$/.exec(name)?.[1]
  let body: unknown
  if (name === 'overview') {
    if (overview?.version !== ds.version) overview = { version: ds.version, lines: overviewLines(ds.links) }
    body = overview.lines
  } else if (name === 'tides-nl') {
    body = await loadOfficialTides()
    if (!body) return new Response('Not found', { status: 404 })
  } else if (name === 'needed') {
    body = await loadNeeded()
  } else if (name === 'coverage') {
    body = (await loadCoverage()).rows
  } else if (name === 'coverage-lines' || /^coverage-lines-(good|some|thin)-\d+$/.test(name)) {
    const { rows } = await loadCoverage()
    if (covLines?.rows !== rows) {
      const lines = coverageLines(ds.links, rows)
      covLines = { rows, chunks: { good: chunkLines(lines.good, CHUNK_BYTES), some: chunkLines(lines.some, CHUNK_BYTES), thin: chunkLines(lines.thin, CHUNK_BYTES) } }
    }
    const c = covLines.chunks
    if (name === 'coverage-lines') body = { good: c.good.length, some: c.some.length, thin: c.thin.length }
    else {
      const [, level, i] = /^coverage-lines-(good|some|thin)-(\d+)$/.exec(name)!
      const chunk = c[level as 'good' | 'some' | 'thin'][Number(i)]
      if (!chunk) return new Response('Not found', { status: 404 })
      body = chunk
    }
  } else if (area) {
    body = areaLines(ds.links, area)
  } else {
    return new Response('Not found', { status: 404 })
  }
  // An old version's URL gets today's data, briefly cached, rather than a 404.
  const live = name.startsWith('coverage') || name === 'needed'
  const cache = version === ds.version && !live ? 'public, max-age=31536000, immutable' : 'public, max-age=300'
  return Response.json(body, { headers: { 'Cache-Control': cache } })
}
