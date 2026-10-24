// Single HTTP entry point for the shared tRPC API. Serves web (cookie) and
// mobile (Bearer JWT) from the same origin — mobile hits `/api/trpc` directly.
// This mount owns the request→user resolution (it has next/headers + the
// Request); the router package stays framework-agnostic.
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@paddlesnitch/api'
import { getRequestUser } from '@/lib/auth'

function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    // Mobile sends `Authorization: Bearer <Cognito ID token>`; web sends the tt_id
    // cookie. Never a device token.
    createContext: async () => ({ user: await getRequestUser(req) }),
  })
}

export { handler as GET, handler as POST }
