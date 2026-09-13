import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'

export async function GET() {
  const user = await getAuthUser()
  // Signed-out is a normal state for this probe (the auth cookie is httpOnly, so
  // the client can't check it and always calls this). Answer 200 with a null body
  // rather than 401 — a 401 here is logged as a console error on every logged-out
  // page load. Callers treat a null body as "not signed in".
  return NextResponse.json(user ?? null)
}
