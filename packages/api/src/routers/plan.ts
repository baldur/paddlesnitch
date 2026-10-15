// Saved river plans (docs/features/river-planner.md). Using the planner needs
// no account; saving does. Plans are private to their owner until shared:
// then anyone with the link may view one, and the owner's buddies see it
// listed. Names, never emails.
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure, publicProcedure } from '../trpc'
import { listBuddies } from '@paddlesnitch/core/buddies'
import { findUserBySub } from '@paddlesnitch/core/cognito'
import { simplify } from '@paddlesnitch/waterways/line'
import { loadNational } from '@paddlesnitch/waterways/national'
import { routePlan, snapClick } from '@paddlesnitch/waterways/plan'
import { NATIONAL, REGIONS } from '@paddlesnitch/waterways/regions'
import {
  savePlan, getPlan, listPlans, deletePlan, sharePlan, unsharePlan, getSharedPlan, MAX_TITLE,
} from '@paddlesnitch/waterways/plan-store'

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const latLng = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])
const nameOf = async (userId: string) => (await findUserBySub(userId))?.displayName || 'A paddler'

const fields = z.object({
  title: z.string().max(MAX_TITLE),
  region: z.string().refine(r => r === NATIONAL || r in REGIONS, 'unknown region'),
  start: latLng,
  finish: latLng,
  shape: z.enum(['one_way', 'return']),
  startAt: z.string().datetime().optional(),
  paceKmh: z.number().min(1).max(30),
  portageMinutes: z.number().min(0).max(120),
})

export const planRouter = router({
  // Snap the clicks to the water and, with both ends, route between them on the
  // national network, returning every stop along the way. No times: the browser
  // works those out from pace and start time (timePlan), so changing them needs
  // no new route. The line is thinned for the map; chainages use the full one.
  route: publicProcedure.input(z.object({
    start: latLng,
    finish: latLng.nullable(),
    shape: z.enum(['one_way', 'return']),
  })).query(async ({ input }) => {
    const ds = await loadNational()
    const s = snapClick(ds, input.start)
    const start = s ? { at: s.at, waterway: s.link.name } : null
    if (!input.finish) return { start, plan: null }
    const plan = routePlan(ds, { start: input.start, finish: input.finish, shape: input.shape })
    return { start, plan: typeof plan === 'string' ? plan : { ...plan, line: simplify(plan.line, 8) } }
  }),

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

  share: protectedProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const plan = await sharePlan(ctx.user.id, input.id)
    if (!plan) throw new TRPCError({ code: 'NOT_FOUND' })
    return plan
  }),

  unshare: protectedProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const plan = await unsharePlan(ctx.user.id, input.id)
    if (!plan) throw new TRPCError({ code: 'NOT_FOUND' })
    return plan
  }),

  // A shared plan, for anyone with its link (signed in or not).
  shared: publicProcedure.input(z.object({ shareId: id })).query(async ({ ctx, input }) => {
    const found = await getSharedPlan(input.shareId)
    if (!found) throw new TRPCError({ code: 'NOT_FOUND' })
    return { plan: found.plan, owner: await nameOf(found.userId), mine: ctx.user?.id === found.userId }
  }),

  // Your buddies' shared plans, newest first.
  buddies: protectedProcedure.query(async ({ ctx }) => {
    const buddies = await listBuddies(ctx.user.id)
    const lists = await Promise.all(buddies.map(async b => {
      const shared = (await listPlans(b.userId)).filter(p => p.shareId)
      if (!shared.length) return []
      const owner = await nameOf(b.userId)
      return shared.map(p => ({ shareId: p.shareId!, title: p.title, shape: p.shape, updatedAt: p.updatedAt, owner }))
    }))
    return lists.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }),

  delete: protectedProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    if (!(await deletePlan(ctx.user.id, input.id))) throw new TRPCError({ code: 'NOT_FOUND' })
    return { ok: true as const }
  }),
})
