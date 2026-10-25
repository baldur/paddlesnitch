// tRPC foundation for the shared API. Framework-agnostic: the context is just a
// resolved user (or null) — the host (the Next mount, or a future standalone
// apps/api) is responsible for turning a cookie or Bearer token into that user
// and passing it in. That keeps this package free of next/headers and reusable
// by web (cookie), mobile (Bearer JWT), and tests (a fake user).
import { initTRPC, TRPCError } from '@trpc/server'
import type { AuthUser } from '@paddlesnitch/core/types'
import { logApiCall, type Client } from '@paddlesnitch/core/observe'

// `client` is set by the HTTP mount (web, apps). In-process callers (SSR,
// tests) leave it out, and their calls aren't logged as API calls.
export type Context = { user: AuthUser | null; client?: Client }

const t = initTRPC.context<Context>().create()

// One log line per HTTP call, with how it ended and how long it took
// (docs/features/observability.md). Outermost, so it sees auth and input
// errors too.
const observed = t.middleware(async ({ ctx, path, type, next }) => {
  if (!ctx.client) return next()
  const start = Date.now()
  const result = await next()
  logApiCall({ path, type, code: result.ok ? undefined : result.error.code, ms: Date.now() - start }, ctx.client)
  return result
})

export const router = t.router
export const publicProcedure = t.procedure.use(observed)

// Requires an authenticated user; narrows ctx.user to non-null for the procedure.
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' })
  return next({ ctx: { user: ctx.user } })
})

export const createCallerFactory = t.createCallerFactory
