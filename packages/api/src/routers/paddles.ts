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

  // Full saved paddle (result + note + insight). Owner only.
  get: protectedProcedure.input(byId).query(async ({ ctx, input }) => {
    const session = await getSession(ctx.user.id, input.id)
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
  // everything but result + narrative + boat (never the owner's userId or note).
  shared: publicProcedure.input(z.object({ shareId: z.string() })).query(async ({ input }) => {
    const session = await getSharedSession(input.shareId)
    if (!session) throw new TRPCError({ code: 'NOT_FOUND' })
    return {
      id: session.id,
      paddledAt: session.paddledAt,
      source: { type: session.source.type },
      result: session.result,
      boatClass: session.boatClass,
      seat: session.seat,
    }
  }),
})
