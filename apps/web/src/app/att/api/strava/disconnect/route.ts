import { NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { disconnectStrava } from '@/lib/strava-disconnect'

export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await disconnectStrava(user.id)
  return NextResponse.json({ ok: true })
}
