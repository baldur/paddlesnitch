import { router, publicProcedure, createCallerFactory } from './trpc'
import { paddlesRouter } from './routers/paddles'
import { sourcesRouter } from './routers/sources'
import { similarRouter } from './routers/similar'

// The single app router. Web (SSR + browser) and mobile consume the same tree.
// File uploads (multipart) stay REST; firmware device endpoints stay REST.
export const appRouter = router({
  // Auth probe: the current user or null (never throws — used to gate UI).
  me: publicProcedure.query(({ ctx }) => ({ user: ctx.user })),
  paddles: paddlesRouter,
  sources: sourcesRouter,
  similar: similarRouter,
})

export type AppRouter = typeof appRouter

// Server-side in-process caller (SSR / tests): `createCaller({ user }).paddles.list()`.
export const createCaller = createCallerFactory(appRouter)
