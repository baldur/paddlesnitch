// Sources router — the "analyse one of my existing things" pickers: ATT trial
// entries (#159), hardware-tracker uploads, and Strava activities. All
// owner-scoped. File upload stays a REST endpoint (multipart), not here.
import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { listUserTrialEntries } from '@paddlesnitch/analysis/trials'
import { listUserDeviceSessions } from '@paddlesnitch/analysis/device-sessions'
import { listActivities } from '@paddlesnitch/core/strava'
import { getValidStravaTokens } from '@paddlesnitch/core/strava-storage'

export const sourcesRouter = router({
  trials: protectedProcedure.query(({ ctx }) => listUserTrialEntries(ctx.user.id)),

  devices: protectedProcedure.query(({ ctx }) => listUserDeviceSessions(ctx.user.id)),

  // A discriminated result: `{ connected:false }` when Strava isn't linked (the
  // old 409), else the activities page. A real fetch failure throws.
  strava: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const tokens = await getValidStravaTokens(ctx.user.id)
      if (!tokens) return { connected: false as const }
      const page = input?.page ?? 1
      const { activities, hasMore } = await listActivities(tokens.accessToken, page)
      return { connected: true as const, activities, page, hasMore }
    }),
})
