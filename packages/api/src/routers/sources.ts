// Sources router — the "analyse one of my existing things" pickers: ATT trial
// entries (#159), hardware-tracker uploads, and Strava activities. All
// owner-scoped. File upload stays a REST endpoint (multipart), not here.
import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { listUserTrialEntries } from '@paddlesnitch/analysis/trials'
import { listUserDeviceSessions } from '@paddlesnitch/analysis/device-sessions'
import { listActivities } from '@paddlesnitch/core/strava'
import { getValidStravaTokens, getStravaHistoryImportedAt, markStravaHistoryImported } from '@paddlesnitch/core/strava-storage'
import { stravaHistory, FIRST_IMPORT_DAYS } from '@paddlesnitch/analysis/strava-history'
import { importStravaActivity } from '@paddlesnitch/analysis/strava-import'

// How far back a history import reaches: 'first' is what connecting Strava
// brings in by itself; the rest are IMPORT OLDER PADDLES choices.
const HISTORY_SPANS = ['first', 'months3', 'year', 'all'] as const
const HISTORY_DAYS: Record<(typeof HISTORY_SPANS)[number], number | null> = { first: FIRST_IMPORT_DAYS, months3: 92, year: 366, all: null }

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

  // Older Strava paddles (#415): the list, then one paddle per call, driven by
  // the paddler's open page (strava-history.ts). `firstImportDone`: the
  // automatic first month already happened, so it isn't offered again.
  stravaHistory: protectedProcedure
    .input(z.object({ since: z.enum(HISTORY_SPANS) }))
    .query(async ({ ctx, input }) => ({
      ...(await stravaHistory(ctx.user.id, HISTORY_DAYS[input.since])),
      firstImportDone: !!(await getStravaHistoryImportedAt(ctx.user.id)),
    })),

  importStravaPaddle: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), sport: z.string().max(40), startDate: z.string().datetime() }))
    .mutation(({ ctx, input }) => importStravaActivity(ctx.user.id, input.id, { sport: input.sport, startDate: input.startDate }, ctx.client)),

  stravaHistoryDone: protectedProcedure.mutation(async ({ ctx }) => {
    await markStravaHistoryImported(ctx.user.id)
    return { ok: true }
  }),
})
