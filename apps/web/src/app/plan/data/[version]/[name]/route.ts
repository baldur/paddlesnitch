// What the planner's map draws, from the live national dataset
// (docs/features/waterways-uk-ireland.md): `overview` (the whole network,
// coarsely), `area-{y}_{x}` (one 0.5° area in detail) and `places` (the places
// search index). The version is in the URL, so a response for the live version
// never changes and can be cached for good.
import { areaLines, overviewLines } from '@paddlesnitch/waterways/display'
import { loadNational } from '@paddlesnitch/waterways/national'

export const dynamic = 'force-dynamic'

let overview: { version: string; lines: unknown } | null = null

export async function GET(_req: Request, { params }: { params: Promise<{ version: string; name: string }> }) {
  const { version, name } = await params
  const ds = await loadNational()
  const area = /^area-(-?\d+_-?\d+)$/.exec(name)?.[1]
  let body: unknown
  if (name === 'overview') {
    if (overview?.version !== ds.version) overview = { version: ds.version, lines: overviewLines(ds.links) }
    body = overview.lines
  } else if (name === 'places') {
    body = ds.places
  } else if (area) {
    body = areaLines(ds.links, area)
  } else {
    return new Response('Not found', { status: 404 })
  }
  // An old version's URL gets today's data, briefly cached, rather than a 404.
  const cache = version === ds.version ? 'public, max-age=31536000, immutable' : 'public, max-age=300'
  return Response.json(body, { headers: { 'Cache-Control': cache } })
}
