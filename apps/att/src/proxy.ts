import { NextRequest, NextResponse } from 'next/server'

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Auth routes always public
  if (pathname.startsWith('/att/auth') || pathname.startsWith('/att/api/auth')) {
    return NextResponse.next()
  }

  // Public POST endpoints that accept UNAUTHENTICATED requests — must be exempt
  // from the mutation auth-gate below, or an anonymous customer's request is
  // redirected to sign-in and silently lost. `feedback` files a GitHub issue
  // from the "Report an issue" widget (att + analyse, which POSTs here across
  // the shared origin); it has its own anti-bot gate and supports anonymous
  // reporters by design. See src/app/att/api/feedback/route.ts.
  if (pathname === '/att/api/feedback') {
    return NextResponse.next()
  }


  // Admin pages always require auth
  const requiresAuth =
    pathname.startsWith('/att/admin') ||
    (req.method !== 'GET' && pathname.startsWith('/att/api') && !pathname.startsWith('/att/api/auth'))

  if (requiresAuth && !req.cookies.get('tt_id')) {
    const url = req.nextUrl.clone()
    url.pathname = '/att/auth'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  // Run on all routes except Next.js internals and static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
