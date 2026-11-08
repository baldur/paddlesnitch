import { NextRequest, NextResponse } from 'next/server'
import { canonicalBaseUrl } from '@paddlesnitch/core/url'

// Magic link is temporarily disabled. See magic-request route.
export async function GET(req: NextRequest) {
  return NextResponse.redirect(new URL('/signin?error=magic_disabled', canonicalBaseUrl(req)))
}
