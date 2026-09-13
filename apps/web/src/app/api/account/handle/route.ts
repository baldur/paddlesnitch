import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { claimHandle, releaseHandle, normaliseHandle, getHandleOwner } from '@/lib/profile'

// GET /api/account/handle?check=<handle>
// Availability check for the claim UI. { available, reason? }. Mine = available
// (re-claiming your own handle is a no-op).
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const raw = req.nextUrl.searchParams.get('check') ?? ''
  const norm = normaliseHandle(raw)
  if ('error' in norm) return NextResponse.json({ available: false, reason: norm.error })
  const owner = await getHandleOwner(norm.slug)
  if (owner && owner !== user.id) return NextResponse.json({ available: false, reason: 'That handle is already taken.' })
  return NextResponse.json({ available: true, slug: norm.slug })
}

// PUT /api/account/handle { handle } — claim or change.
export async function PUT(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const result = await claimHandle(user.id, body.handle)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result)
}

// DELETE /api/account/handle — give up the handle.
export async function DELETE() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await releaseHandle(user.id))
}
