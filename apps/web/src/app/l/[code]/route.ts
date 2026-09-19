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
  // A RELATIVE Location, deliberately. NextResponse.redirect() demands an
  // absolute URL, and behind CloudFront -> Lambda `req.url` is the Lambda
  // function URL, not paddlesnitch.com -- so building from it sent the user to
  // `<hash>.lambda-url.eu-west-1.on.aws`. The auth cookie is scoped to
  // paddlesnitch.com, so they would arrive SIGNED OUT, which breaks
  // scan-to-link for precisely the people it exists for.
  //
  // HTTP allows a relative Location and the browser resolves it against what it
  // asked for, which is the real hostname. That is origin-agnostic and needs no
  // env var or header sniffing.
  return new Response(null, { status: 307, headers: { Location: target } })
}
