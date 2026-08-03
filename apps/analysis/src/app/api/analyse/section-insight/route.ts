import { NextResponse } from 'next/server'
import { getAuthUser } from '@paddlesnitch/core/auth'
import { getSession } from '@/lib/analysis-store'
import { sectionStats, MIN_SECTION_M } from '@/lib/similar'
import { generateSectionInsight, buildSectionInsight } from '@/lib/llm'

// POST /analyse/api/analyse/section-insight — body { sourceId, aIdx, bIdx }.
// Narrates ONE stretch the paddler selected on their own paddle (the literal
// slice between the two clicked points). Own paddles only.
export async function POST(req: Request) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const sourceId = body?.sourceId
  const aIdx = Number(body?.aIdx), bIdx = Number(body?.bIdx)
  if (typeof sourceId !== 'string' || !Number.isInteger(aIdx) || !Number.isInteger(bIdx)) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const source = await getSession(user.id, sourceId)
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const stats = sectionStats(source, aIdx, bIdx)
  if (!stats) return NextResponse.json({ error: 'Invalid selection' }, { status: 400 })
  if (stats.sectionM < MIN_SECTION_M) return NextResponse.json({ reason: 'section_too_short', sectionM: stats.sectionM }, { status: 422 })

  const llm = await generateSectionInsight(stats)
  return NextResponse.json({ stats, insight: llm?.text ?? buildSectionInsight(stats), insightModel: llm?.model })
}
