// OpenPortage contributions (docs/features/river-planner.md, "Contributions";
// packages/waterways/src/portage.ts). Adding one needs an account and an
// explicit CC0 release; it goes live at once. Anyone signed in can flag one,
// the author can withdraw it, a platform admin can hide or restore it.
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { haversine } from '@paddlesnitch/timing/geo'
import { isPlatformAdmin } from '@paddlesnitch/core/admin'
import { MAX_CARRY_M, MAX_NOTES } from '@paddlesnitch/waterways/portage'
import { addPortage, deletePortage, flagPortage, hidePortage, listMyPortages } from '@paddlesnitch/waterways/portage-store'
import { router, protectedProcedure } from '../trpc'

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const latLng = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])
/** Landings must be near the lock or weir they're about. */
const LANDING_NEAR_M = 400

export const portageRouter = router({
  add: protectedProcedure.input(z.object({
    featureId: z.string().max(200).optional(),
    at: latLng,
    landings: z.tuple([latLng, latLng]),
    notes: z.string().max(MAX_NOTES).optional(),
    rollers: z.boolean().optional(),
    cc0: z.literal(true),          // "I release this under CC0, and it's my own observation"
  })).mutation(async ({ ctx, input }) => {
    const [a, b] = input.landings
    if (haversine(a, b) > MAX_CARRY_M || haversine(a, b) < 2) throw new TRPCError({ code: 'BAD_REQUEST', message: 'landings_apart' })
    if (haversine(a, input.at) > LANDING_NEAR_M || haversine(b, input.at) > LANDING_NEAR_M) throw new TRPCError({ code: 'BAD_REQUEST', message: 'landings_far' })
    const { cc0: _, notes, ...fields } = input
    return addPortage({ id: ctx.user.id, name: ctx.user.displayName || 'A paddler' }, { ...fields, notes: notes?.trim() || undefined })
  }),

  mine: protectedProcedure.query(({ ctx }) => listMyPortages(ctx.user.id)),

  delete: protectedProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    if (!(await deletePortage(ctx.user.id, input.id))) throw new TRPCError({ code: 'NOT_FOUND' })
    return { ok: true as const }
  }),

  flag: protectedProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const r = await flagPortage(ctx.user.id, input.id)
    if (!r) throw new TRPCError({ code: 'NOT_FOUND' })
    return { result: r }
  }),

  hide: protectedProcedure.input(z.object({ id, hidden: z.boolean() })).mutation(async ({ ctx, input }) => {
    if (!isPlatformAdmin(ctx.user)) throw new TRPCError({ code: 'FORBIDDEN' })
    if (!(await hidePortage(input.id, input.hidden))) throw new TRPCError({ code: 'NOT_FOUND' })
    return { ok: true as const }
  }),
})

