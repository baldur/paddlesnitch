// Single HTTP entry point for the shared tRPC API. Serves web (cookie) and
// mobile (Bearer JWT) from the same origin — mobile hits `/api/trpc` directly.
// This mount owns the request→user resolution (it has next/headers + the
// Request); the router package stays framework-agnostic.
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@paddlesnitch/api'
import { getAuthUser } from '@/lib/auth'
import { verifyIdToken } from '@paddlesnitch/core/cognito'

// Mobile sends `Authorization: Bearer <Cognito ID token>`; web sends the tt_id
// httpOnly cookie (read by getAuthUser via next/headers). Never a device token.
async function resolveUser(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return verifyIdToken(auth.slice(7))
  return getAuthUser()
}

function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: async () => ({ user: await resolveUser(req) }),
  })
}

export { handler as GET, handler as POST }
