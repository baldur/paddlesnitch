import { NextRequest, NextResponse } from 'next/server'

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // The tracker's claim QR carries an UPPERCASE URL on purpose: all-caps puts it
  // in QR alphanumeric mode, which packs 2 characters per 11 bits and drops the
  // code to QR version 1 -- fewer modules and a wider quiet zone on a 64 px
  // panel, which is what makes it scannable. Serve /L/ from the /l/ handler
  // here, with an exact, case-sensitive check. This used to be a next.config
  // redirect, but Next matches those case-INsensitively, so /l/ matched /L/:code
  // too and redirected to itself forever; it only worked in prod because the
  // hosting layer's router happens to be case-sensitive. A REWRITE, not a
  // redirect: internal, so no extra hop and no absolute URL (behind CloudFront
  // the request URL is the Lambda's own host; see app/l/[code]/route.ts).
  if (pathname.startsWith('/L/')) {
    const to = req.nextUrl.clone()
    to.pathname = `/l/${pathname.slice(3)}`
    return NextResponse.rewrite(to)
  }

  // Auth routes always public
  if (pathname.startsWith('/signin') || pathname.startsWith('/att/api/auth')) {
    return NextResponse.next()
  }

  // Public POST endpoints that accept UNAUTHENTICATED requests — must be exempt
  // from the mutation auth-gate below, or an anonymous request is redirected to
  // sign-in (307) and silently lost.
  //  - `feedback` files a GitHub issue from the "Report an issue" widget (att +
  //    analyse, POSTing across the shared origin); anti-bot gated, anonymous by
  //    design. See src/app/att/api/feedback/route.ts.
  //  - `track` receives client analytics beacons (pageviews etc.); events come
  //    from anyone (signed-out included) and it drops non-allowlisted input, so
  //    without this exemption every signed-out beacon 307s and no anonymous
  //    traffic is ever recorded. See src/app/att/api/track/route.ts.
  if (pathname === '/att/api/feedback' || pathname === '/att/api/track') {
    return NextResponse.next()
  }


  // Admin pages, your account and your own profile always require auth.
  // `/profile/:id` (public profiles) is NOT gated — only `/profile/me*`.
  const requiresAuth =
    pathname.startsWith('/att/admin') ||
    pathname.startsWith('/profile/me') ||
    pathname === '/account' || pathname.startsWith('/account/') ||
    pathname === '/devices' || pathname.startsWith('/devices/') ||
    (req.method !== 'GET' &&
      (pathname.startsWith('/att/api') || pathname.startsWith('/api/account')) &&
      !pathname.startsWith('/att/api/auth'))

  if (requiresAuth && !req.cookies.get('tt_id')) {
    // `next` carries the QUERY STRING as well as the path. It used to be the
    // pathname alone, while the clone kept the original params — so a gated URL
    // like /devices?code=ABC123 redirected to
    // /signin?code=ABC123&next=/devices and the code was silently
    // dropped on the way back. That breaks the scan-to-link QR for anyone not
    // already signed in, which is most people setting up a device.
    const target = pathname + req.nextUrl.search
    const url = req.nextUrl.clone()
    url.pathname = '/signin'
    url.search = ''
    url.searchParams.set('next', target)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  // Run on all routes except Next.js internals and static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
