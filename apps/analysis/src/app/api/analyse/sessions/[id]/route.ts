import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@paddlesnitch/core/auth'
import { getSession, updateSessionNote, updateSessionDoubling, deleteSession } from '@/lib/analysis-store'

type Params = { params: Promise<{ id: string }> }

// GET — full saved session (result + note + insight), owner only.
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const session = await getSession(user.id, id)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ session })
}

// PATCH — set the diary note ({ note }) OR flip the SUP→kayak stroke-rate
// doubling ({ doubleStrokeRate }). Owner only.
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const session = typeof body.doubleStrokeRate === 'boolean'
    ? await updateSessionDoubling(user.id, id, body.doubleStrokeRate)
    : await updateSessionNote(user.id, id, typeof body.note === 'string' ? body.note : '')
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ session })
}

// DELETE — remove a saved paddle. Owner only.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  await deleteSession(user.id, id)
  return NextResponse.json({ ok: true })
}
