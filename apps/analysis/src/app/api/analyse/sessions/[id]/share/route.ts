import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@paddlesnitch/core/auth'
import { shareSession, unshareSession } from '@/lib/analysis-store'

type Params = { params: Promise<{ id: string }> }

// POST — opt this paddle into a public, unlisted share link. Owner only.
// Returns the share token so the client can build /analyse/shared/{shareId}.
export async function POST(_req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const shared = await shareSession(user.id, id)
  if (!shared) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ shareId: shared.shareId })
}

// DELETE — revoke the public share link. Owner only.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const session = await unshareSession(user.id, id)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
