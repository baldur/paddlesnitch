// Similar-sections router — "race a section" across the user's own paddles
// (#163). Reads only; own paddles only. Each procedure derives a gate from two
// clicked point-indices on a source paddle. The "not enough / too short"
// outcomes are returned as typed unions (the client branches on them), matching
// the old 422 bodies; genuinely-missing sources throw NOT_FOUND.
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import { getSession, listSessions, type AnalysisSession } from '@paddlesnitch/analysis/analysis-store'
import { findSimilar, buildRace, sectionStats, MIN_SECTION_M } from '@paddlesnitch/analysis/similar'
import {
  generateRaceInsight, buildRaceInsight,
  generateSectionInsight, buildSectionInsight,
} from '@paddlesnitch/analysis/llm'

const sel = z.object({ sourceId: z.string(), aIdx: z.number().int(), bIdx: z.number().int() })

async function loadSource(userId: string, sourceId: string) {
  const source = await getSession(userId, sourceId)
  if (!source) throw new TRPCError({ code: 'NOT_FOUND' })
  return source
}

export const similarRouter = router({
  // List the user's other paddles that cross the derived gate (fastest valid pair).
  find: protectedProcedure.input(sel).query(async ({ ctx, input }) => {
    const source = await loadSource(ctx.user.id, input.sourceId)
    const pts = source.result.points
    if (input.aIdx < 0 || input.bIdx < 0 || input.aIdx >= pts.length || input.bIdx >= pts.length) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Index out of range' })
    }
    return findSimilar(source, await listSessions(ctx.user.id), input.aIdx, input.bIdx)
  }),

  // Build the race board for the chosen subset (+ a coach narrative) over the stretch.
  compare: protectedProcedure.input(sel.extend({ sessionIds: z.array(z.string()) })).query(async ({ ctx, input }) => {
    const source = await loadSource(ctx.user.id, input.sourceId)
    const picked = (await Promise.all(
      input.sessionIds.filter(id => id !== input.sourceId).map(id => getSession(ctx.user.id, id)),
    )).filter((s): s is AnalysisSession => !!s)

    const race = buildRace(source, picked, input.aIdx, input.bIdx)
    if ('reason' in race) return { race: null, reason: race.reason }
    if (race.racers.length >= 2) {
      const llm = await generateRaceInsight(race)
      race.insight = llm?.text ?? buildRaceInsight(race)
      race.insightModel = llm?.model
    }
    return { race, reason: null }
  }),

  // Narrate ONE selected stretch on the paddler's own paddle.
  sectionInsight: protectedProcedure.input(sel).query(async ({ ctx, input }) => {
    const source = await loadSource(ctx.user.id, input.sourceId)
    const stats = sectionStats(source, input.aIdx, input.bIdx)
    if (!stats) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid selection' })
    if (stats.sectionM < MIN_SECTION_M) return { stats: null, reason: 'section_too_short' as const, sectionM: stats.sectionM }
    const llm = await generateSectionInsight(stats)
    return { stats, insight: llm?.text ?? buildSectionInsight(stats), insightModel: llm?.model, reason: null }
  }),
})
