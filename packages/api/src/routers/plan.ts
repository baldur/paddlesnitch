// Saved river plans (docs/features/river-planner.md). Using the planner needs
// no account; saving does. Plans are private to their owner.
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import { REGIONS } from '@paddlesnitch/waterways/regions'
import { savePlan, getPlan, listPlans, deletePlan, MAX_TITLE } from '@paddlesnitch/waterways/plan-store'

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const latLng = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])
const fields = z.object({
  title: z.string().max(MAX_TITLE),
  region: z.string().refine(r => r in REGIONS, 'unknown region'),
  start: latLng,
  finish: latLng,
  shape: z.enum(['one_way', 'return']),
  startAt: z.string().datetime().optional(),
  paceKmh: z.number().min(1).max(30),
  portageMinutes: z.number().min(0).max(120),
})

export const planRouter = router({
  list: protectedProcedure.query(({ ctx }) => listPlans(ctx.user.id)),

  get: protectedProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const plan = await getPlan(ctx.user.id, input.id)
    if (!plan) throw new TRPCError({ code: 'NOT_FOUND' })
    return plan
  }),

  // Without an id, a new plan; with one, an update to that plan.
  save: protectedProcedure.input(fields.extend({ id: id.optional() })).mutation(async ({ ctx, input }) => {
    const { id: planId, ...rest } = input
    const saved = await savePlan(ctx.user.id, rest, planId)
    if (saved === 'too_many') throw new TRPCError({ code: 'BAD_REQUEST', message: 'too_many_plans' })
    if (!saved) throw new TRPCError({ code: 'NOT_FOUND' })
    return saved
  }),

  delete: protectedProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    if (!(await deletePlan(ctx.user.id, input.id))) throw new TRPCError({ code: 'NOT_FOUND' })
    return { ok: true as const }
  }),
})
