// A region's planner dataset (packages/waterways/data/<region>.json), built
// once at deploy and cached. The planner computes routes in the browser from it.
import dw from '@paddlesnitch/waterways/data/dw.json'

const DATA: Record<string, unknown> = { dw }

export const dynamic = 'force-static'

export function generateStaticParams() {
  return Object.keys(DATA).map(region => ({ region }))
}

export async function GET(_req: Request, { params }: { params: Promise<{ region: string }> }) {
  const data = DATA[(await params).region]
  if (!data) return new Response('Not found', { status: 404 })
  return Response.json(data, { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } })
}
