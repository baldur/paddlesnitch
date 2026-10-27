import { NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { findUserBySub } from '@/lib/cognito'

// GET /api/account/google — whether Google signs in to this account: it's a
// Google account, or Google was connected to it (Connect Google, lib/google-link.ts).
export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  const me = await findUserBySub(user.id)
  return NextResponse.json({ signsInWithGoogle: !!me?.google, connected: !!(me?.google || me?.googleLinked) })
}
