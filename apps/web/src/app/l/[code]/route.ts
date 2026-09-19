import { NextResponse } from 'next/server'

// The target of the claim QR on the device's screen.
//
// Short on purpose. The QR is version 2 at ECC L, which holds exactly 32 bytes,
// and the payload is `paddlesnitch.com/l/ABC123` at 25 — there is no room for
// `https://` (33 bytes) or for a longer path like `/devices/link/`. If this
// route ever moves, the QR stops fitting on the panel, so it lives at `/l/`
// and should stay there.
//
// Deliberately NOT auth-gated: the redirect itself reveals nothing (the code is
// already on a screen in the room, is single-use, and expires in ten minutes),
// and gating it here would bounce the user to sign-in from a route that has no
// way to explain itself. The settings page it lands on IS gated, so a
// signed-out user gets the normal sign-in with `next` carrying the code
// through the round trip.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params
  // Normalised here rather than at the far end: the device shows uppercase, a
  // camera may hand over whatever it read, and the link route is the one place
  // both paths pass through.
  const clean = (code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  const target = clean
    ? `/profile/me/settings?code=${encodeURIComponent(clean)}#devices`
    : '/profile/me/settings#devices'
  return NextResponse.redirect(new URL(target, process.env.NEXT_PUBLIC_SITE_URL ?? _req.url))
}
