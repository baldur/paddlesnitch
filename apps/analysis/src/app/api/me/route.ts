import { NextResponse } from 'next/server'
import { getAuthUser } from '@paddlesnitch/core/auth'

// Auth check for the analysis page: returns { user } — null when signed out.
// Signed-out is normal for this probe (the auth cookie is httpOnly, so the client
// always calls this); answering 200 with a null user rather than 401 keeps a
// logged-out page load from logging a console error.
export async function GET() {
  const user = await getAuthUser()
  return NextResponse.json({ user: user ?? null })
}
