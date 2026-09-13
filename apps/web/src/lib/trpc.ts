'use client'
// Typed tRPC React client. `AppRouter` is a TYPE-ONLY import, so no server code
// from @paddlesnitch/api is pulled into the browser bundle — the client gets the
// full end-to-end types with zero codegen.
import { createTRPCReact } from '@trpc/react-query'
import type { AppRouter } from '@paddlesnitch/api'

export const trpc = createTRPCReact<AppRouter>()
