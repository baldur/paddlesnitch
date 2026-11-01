// Buddies (docs/features/buddies-and-compare.md): the lists, requests, invite
// links and the sharing switch. Names come from the account (display name);
// a buddy never sees another person's email.
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import {
  listBuddies, listIncomingRequests, listOutgoingRequests, requestBuddy, acceptRequest, declineRequest,
  cancelRequest, removeBuddy, getInviteToken, rotateInvite, acceptInvite, inviteOwner, areBuddies,
  getBuddySharing, setBuddySharing, canViewPaddle,
} from '@paddlesnitch/core/buddies'
import { isPhonePaddle } from '@paddlesnitch/core/paddles'
import { listSessionSummaries, getSession } from '@paddlesnitch/analysis/analysis-store'
import { othersView } from './paddles'
import { findUserBySub } from '@paddlesnitch/core/cognito'
import { rateLimit } from '@paddlesnitch/core/rate-limit'

const userId = z.object({ userId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) })
// A person asks a handful of buddies an hour; a script asking everyone doesn't.
export const REQUESTS_PER_HOUR = 30

async function nameOf(id: string): Promise<string> {
  return (await findUserBySub(id))?.displayName || 'A paddler'
}
const named = async <T extends { userId: string }>(xs: T[]) =>
  Promise.all(xs.map(async x => ({ ...x, name: await nameOf(x.userId) })))

export const buddiesRouter = router({
  // Everything the Buddies page shows.
  list: protectedProcedure.query(async ({ ctx }) => {
    const [buddies, incoming, outgoing, sharing] = await Promise.all([
      listBuddies(ctx.user.id), listIncomingRequests(ctx.user.id), listOutgoingRequests(ctx.user.id), getBuddySharing(ctx.user.id),
    ])
    return { buddies: await named(buddies), incoming: await named(incoming), outgoing: await named(outgoing), sharing }
  }),

  // For the badge in the account menu.
  pendingCount: protectedProcedure.query(async ({ ctx }) => (await listIncomingRequests(ctx.user.id)).length),

  // Where the viewer stands with one person (the profile's button).
  status: protectedProcedure.input(userId).query(async ({ ctx, input }) => {
    if (input.userId === ctx.user.id) return 'self' as const
    if (await areBuddies(ctx.user.id, input.userId)) return 'buddies' as const
    if ((await listIncomingRequests(ctx.user.id)).some(r => r.userId === input.userId)) return 'asked_you' as const
    if ((await listOutgoingRequests(ctx.user.id)).some(r => r.userId === input.userId)) return 'asked' as const
    return 'none' as const
  }),

  request: protectedProcedure.input(userId).mutation(async ({ ctx, input }) => {
    const limit = await rateLimit(`buddy-request-${ctx.user.id}`, REQUESTS_PER_HOUR, 3600)
    if (!limit.allowed) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: "You've sent a lot of requests. Try again in an hour." })
    if (input.userId !== ctx.user.id && !(await findUserBySub(input.userId))) throw new TRPCError({ code: 'NOT_FOUND' })
    return requestBuddy(ctx.user.id, input.userId)
  }),

  accept: protectedProcedure.input(userId).mutation(async ({ ctx, input }) => {
    if (!(await acceptRequest(ctx.user.id, input.userId))) throw new TRPCError({ code: 'NOT_FOUND' })
    return { ok: true as const }
  }),
  decline: protectedProcedure.input(userId).mutation(async ({ ctx, input }) => { await declineRequest(ctx.user.id, input.userId); return { ok: true as const } }),
  cancel: protectedProcedure.input(userId).mutation(async ({ ctx, input }) => { await cancelRequest(ctx.user.id, input.userId); return { ok: true as const } }),
  remove: protectedProcedure.input(userId).mutation(async ({ ctx, input }) => { await removeBuddy(ctx.user.id, input.userId); return { ok: true as const } }),

  invite: protectedProcedure.query(async ({ ctx }) => ({ token: await getInviteToken(ctx.user.id) })),
  newInvite: protectedProcedure.mutation(async ({ ctx }) => ({ token: await rotateInvite(ctx.user.id) })),
  // Opening someone's invite link: you become buddies with them.
  acceptInvite: protectedProcedure.input(z.object({ token: z.string().max(100) })).mutation(async ({ ctx, input }) => {
    const owner = await inviteOwner(input.token)
    const outcome = await acceptInvite(ctx.user.id, input.token)
    return { outcome, name: owner && outcome !== 'invalid' ? await nameOf(owner) : null }
  }),

  // A buddy's paddles, newest first: only ones they let buddies see, and only
  // the safe fields (a stored summary also carries the note and the AI text).
  // Not a buddy, or sharing off: NOT_FOUND, never a hint either way.
  paddles: protectedProcedure.input(userId).query(async ({ ctx, input }) => {
    if (input.userId === ctx.user.id || !(await canViewPaddle(ctx.user.id, input.userId, {}))) throw new TRPCError({ code: 'NOT_FOUND' })
    const summaries = await listSessionSummaries(input.userId)
    return {
      name: await nameOf(input.userId),
      paddles: summaries.filter(s => !s.hiddenFromBuddies).map(s => ({
        id: s.id, paddledAt: s.paddledAt, source: { type: s.source.type, ...(isPhonePaddle(s.source) ? { phone: true as const } : {}) },
        durationS: s.durationS, distanceKm: s.distanceKm, cruiseSpeed: s.cruiseSpeed, avgSR: s.avgSR,
        boatClass: s.boatClass, route: s.route, ...(s.noGps ? { noGps: true as const } : {}),
      })),
    }
  }),

  // One of a buddy's paddles, as others see it (no note, no AI text).
  paddle: protectedProcedure.input(userId.extend({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) })).query(async ({ ctx, input }) => {
    const session = input.userId === ctx.user.id ? null : await getSession(input.userId, input.id)
    if (!session || !(await canViewPaddle(ctx.user.id, input.userId, session))) throw new TRPCError({ code: 'NOT_FOUND' })
    return { name: await nameOf(input.userId), paddle: othersView(session) }
  }),

  setSharing: protectedProcedure.input(z.object({ paddles: z.boolean() })).mutation(async ({ ctx, input }) => {
    await setBuddySharing(ctx.user.id, input.paddles)
    return { paddles: input.paddles }
  }),
})
