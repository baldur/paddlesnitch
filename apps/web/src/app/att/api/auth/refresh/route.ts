import { NextResponse } from 'next/server'
import { refresh } from '@/lib/cognito'

// The apps' silent refresh (docs/features/mobile-apps.md, C2): swap the
// refresh token they keep for a new ID token. 401 means sign in again (the
// token expired after 30 days, or was revoked by signing out). The website
// refreshes from its cookie inside getAuthUser instead.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : ''
  const result = refreshToken ? await refresh(refreshToken) : { error: 'invalid_credentials' as const }
  if ('error' in result) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 })
  return NextResponse.json({ idToken: result.idToken })
}
