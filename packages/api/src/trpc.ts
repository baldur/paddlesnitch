// tRPC foundation for the shared API. Framework-agnostic: the context is just a
// resolved user (or null) — the host (the Next mount, or a future standalone
// apps/api) is responsible for turning a cookie or Bearer token into that user
// and passing it in. That keeps this package free of next/headers and reusable
// by web (cookie), mobile (Bearer JWT), and tests (a fake user).
import { initTRPC, TRPCError } from '@trpc/server'
import type { AuthUser } from '@paddlesnitch/core/types'

export type Context = { user: AuthUser | null }

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

// Requires an authenticated user; narrows ctx.user to non-null for the procedure.
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' })
  return next({ ctx: { user: ctx.user } })
})

export const createCallerFactory = t.createCallerFactory
