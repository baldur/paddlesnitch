// Paddles router — the saved-paddle domain: the dashboard rollup, the library
// list, and per-paddle read + mutations (note / boat / stroke-doubling / delete
// / share). Reads/writes go through the analysis service layer; auth is enforced
// by protectedProcedure (owner-scoped by ctx.user.id). One public procedure:
// `shared`, the unlisted read-only view.
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure, publicProcedure } from '../trpc'
import { listPaddleCards } from '@paddlesnitch/core/paddle-store'
import { paddleTotals } from '@paddlesnitch/core/paddles'
import { plainInsight } from '@paddlesnitch/analysis/analysis'
import { paddleIdsByRecording } from '@paddlesnitch/analysis/tracker-paddle'
import { timeOverlapShare, isSameOuting, trackGap, strokeRateSideBySide, MIN_TIME_OVERLAP } from '@paddlesnitch/analysis/same-outing'
import { paddleHighlights } from '@paddlesnitch/analysis/history-stats'
import { writePendingSummary } from '@paddlesnitch/analysis/pipeline'
import {
  listSessionSummaries, getSession, deleteSession,
  updateSessionNote, updateSessionBoat, updateSessionDoubling,
  shareSession, unshareSession, getSharedSession,
} from '@paddlesnitch/analysis/analysis-store'

const byId = z.object({ id: z.string() })

export const paddlesRouter = router({
  // Dashboard/home payload: lean cards + rolled-up totals.
  list: protectedProcedure.query(async ({ ctx }) => {
    const cards = await listPaddleCards(ctx.user.id)
    return { cards, totals: paddleTotals(cards) }
  }),

  // Library list: richer per-paddle summaries (note, effort count, …), newest first.
  sessions: protectedProcedure.query(({ ctx }) => listSessionSummaries(ctx.user.id)),

  // Which paddle each tracker recording became: { recordingId: paddleId }.
  // The tracker's page links its recordings to their paddles with it.
  byRecording: protectedProcedure.query(async ({ ctx }) => paddleIdsByRecording(await listSessionSummaries(ctx.user.id))),

  // Records and comparisons for the paddle page ("Fastest cruise yet"), from
  // the history the written summary already uses. Other recordings of this
  // same outing (overlapping in time) are left out of the comparison.
  highlights: protectedProcedure.input(byId).query(async ({ ctx, input }) => {
    const all = await listSessionSummaries(ctx.user.id)
    const me = all.find(s => s.id === input.id)
    if (!me) throw new TRPCError({ code: 'NOT_FOUND' })
    const others = all.filter(s => s.id !== me.id && timeOverlapShare(me, s) < MIN_TIME_OVERLAP)
    return paddleHighlights({
      paddledAt: me.paddledAt, cruiseSpeed: me.cruiseSpeed, distanceKm: me.distanceKm,
      avgSR: me.avgSR, avgDps: me.avgDps, boatClass: me.boatClass,
    }, others)
  }),

  // The same outing recorded by another source (one-paddle.md, phase 4): the
  // user's other paddles that overlap this one in time AND in place. Only the
  // few that overlap in time are loaded to compare tracks.
  sameOuting: protectedProcedure.input(byId).query(async ({ ctx, input }) => {
    const all = await listSessionSummaries(ctx.user.id)
    const me = all.find(s => s.id === input.id)
    if (!me) throw new TRPCError({ code: 'NOT_FOUND' })
    const near = all.filter(s => s.id !== me.id && timeOverlapShare(me, s) >= MIN_TIME_OVERLAP)
    if (near.length === 0) return []
    const self = await getSession(ctx.user.id, me.id)
    const out: { id: string; sourceType: string; paddledAt: string }[] = []
    for (const s of near) {
      const other = await getSession(ctx.user.id, s.id)
      if (self && other && isSameOuting(self, other)) out.push({ id: s.id, sourceType: s.source.type, paddledAt: s.paddledAt })
    }
    return out
  }),

  // The two recordings of one outing side by side: how far apart they put you
  // at the same moments, and stroke rate from each by clock minute.
  compareOuting: protectedProcedure.input(z.object({ a: z.string(), b: z.string() })).query(async ({ ctx, input }) => {
    const [a, b] = await Promise.all([getSession(ctx.user.id, input.a), getSession(ctx.user.id, input.b)])
    if (!a || !b) throw new TRPCError({ code: 'NOT_FOUND' })
    if (!isSameOuting(a, b)) return { same: false as const }
    return { same: true as const, gap: trackGap(a, b), strokeRate: strokeRateSideBySide(a, b) }
  }),

  // Full saved paddle (result + note + insight). Owner only.
  get: protectedProcedure.input(byId).query(async ({ ctx, input }) => {
    const session = await getSession(ctx.user.id, input.id)
    if (!session) throw new TRPCError({ code: 'NOT_FOUND' })
    return session
  }),

  // Write the AI summary of a paddle that was saved without one so it could
  // open at once (performance.md, phase 4). The paddle page calls this while
  // it shows "writing your summary…". Already written → the paddle as it is.
  writeSummary: protectedProcedure.input(byId).mutation(async ({ ctx, input }) => {
    const session = await writePendingSummary(ctx.user.id, input.id)
    if (!session) throw new TRPCError({ code: 'NOT_FOUND' })
    return session
  }),

  delete: protectedProcedure.input(byId).mutation(async ({ ctx, input }) => {
    await deleteSession(ctx.user.id, input.id)
    return { ok: true as const }
  }),

  setNote: protectedProcedure.input(byId.extend({ note: z.string() })).mutation(async ({ ctx, input }) => {
    const session = await updateSessionNote(ctx.user.id, input.id, input.note)
    if (!session) throw new TRPCError({ code: 'NOT_FOUND' })
    return session
  }),

  // boatClass/seat are validated + sanitised inside updateSessionBoat (resolveBoat),
  // so pass them through as unknown.
  setBoat: protectedProcedure.input(byId.extend({ boatClass: z.unknown(), seat: z.unknown() })).mutation(async ({ ctx, input }) => {
    const session = await updateSessionBoat(ctx.user.id, input.id, input.boatClass, input.seat)
    if (!session) throw new TRPCError({ code: 'NOT_FOUND' })
    return session
  }),

  setDoubling: protectedProcedure.input(byId.extend({ doubleStrokeRate: z.boolean() })).mutation(async ({ ctx, input }) => {
    const session = await updateSessionDoubling(ctx.user.id, input.id, input.doubleStrokeRate)
    if (!session) throw new TRPCError({ code: 'NOT_FOUND' })
    return session
  }),

  share: protectedProcedure.input(byId).mutation(async ({ ctx, input }) => {
    const shared = await shareSession(ctx.user.id, input.id)
    if (!shared) throw new TRPCError({ code: 'NOT_FOUND' })
    return { shareId: shared.shareId }
  }),

  unshare: protectedProcedure.input(byId).mutation(async ({ ctx, input }) => {
    const session = await unshareSession(ctx.user.id, input.id)
    if (!session) throw new TRPCError({ code: 'NOT_FOUND' })
    return { ok: true as const }
  }),

  // Public read-only view of a shared paddle (#202) — token only, no auth. Strips
  // everything but result + boat (never the owner's userId or note). The AI
  // summary is swapped for the plain one: it is written from the owner's diary
  // notes and coach profile, so it can repeat private text.
  shared: publicProcedure.input(z.object({ shareId: z.string() })).query(async ({ input }) => {
    const session = await getSharedSession(input.shareId)
    if (!session) throw new TRPCError({ code: 'NOT_FOUND' })
    return {
      id: session.id,
      paddledAt: session.paddledAt,
      source: { type: session.source.type },
      result: { ...session.result, insight: plainInsight(session.result), insightModel: undefined },
      boatClass: session.boatClass,
      seat: session.seat,
    }
  }),
})
