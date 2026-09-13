import { NextResponse } from 'next/server'
import { readTosDoc } from '@/lib/tos'
import { CURRENT_TOS_VERSION } from '@/lib/types'

// GET /att/api/legal/tos
// Returns the current Terms of Service markdown + version. Public — no
// auth required. Used by the signup form to render the ToS inline, and
// by the standalone /att/tos page.
export async function GET() {
  const body = await readTosDoc(CURRENT_TOS_VERSION)
  if (!body) {
    return NextResponse.json({ error: 'ToS document missing' }, { status: 500 })
  }
  return NextResponse.json({ version: CURRENT_TOS_VERSION, body })
}
