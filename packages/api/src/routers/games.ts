// The kayak game (games/kayak): a leaderboard per course, and the mailbox live
// races use to connect browser to browser (docs/features/game-accounts-leaderboard-live.md).
// Plain JSON over tRPC: the game is static files on the same origin, so it calls
// these with fetch and the visitor's sign-in cookie.
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { findUserBySub } from '@paddlesnitch/core/cognito'
import {
  GAME_COURSES, GAME_HULLS, createRoom, getLeaderboard, getRoom, joinRoom, listPlayers,
  plausible, sendMessage, shortName, submitResult, takeMessages, type GameCourse,
} from '@paddlesnitch/core/games'
import { router, publicProcedure, protectedProcedure } from '../trpc'

const course = z.enum(Object.keys(GAME_COURSES) as [GameCourse, ...GameCourse[]])
const code = z.string().regex(/^[A-Z]{4}$/)
const sdp = z.string().max(20_000)

// The account's name (the sign-in token's copy can lag behind), shortened.
async function nameOf(user: { id: string; displayName?: string }) {
  return shortName((await findUserBySub(user.id).catch(() => null))?.displayName || user.displayName)
}

// Only a player in the room may use its mailbox.
async function inRoom(c: string, userId: string) {
  const room = await getRoom(c)
  if (!room) throw new TRPCError({ code: 'NOT_FOUND', message: 'race_gone' })
  const players = await listPlayers(c)
  if (!players.some((p) => p.id === userId)) throw new TRPCError({ code: 'FORBIDDEN' })
  return { room, players }
}

export const gamesRouter = router({
  leaderboard: publicProcedure.input(z.object({ course })).query(({ ctx, input }) => getLeaderboard(input.course, ctx.user?.id)),

  submit: protectedProcedure.input(z.object({
    course, time: z.number().positive(), hull: z.enum(GAME_HULLS),
  })).mutation(async ({ ctx, input }) => {
    if (!plausible(input.course, input.time)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'implausible_time' })
    const entry = { userId: ctx.user.id, name: await nameOf(ctx.user), time: Math.round(input.time * 10) / 10, hull: input.hull, at: new Date().toISOString() }
    return submitResult(input.course, entry)
  }),

  live: router({
    create: protectedProcedure.input(z.object({ course })).mutation(async ({ ctx, input }) => {
      const room = await createRoom(input.course, { id: ctx.user.id, name: await nameOf(ctx.user) })
      return { room, players: await listPlayers(room.code), you: ctx.user.id }
    }),

    join: protectedProcedure.input(z.object({ code })).mutation(async ({ ctx, input }) => {
      const joined = await joinRoom(input.code, { id: ctx.user.id, name: await nameOf(ctx.user) })
      if (!joined) throw new TRPCError({ code: 'NOT_FOUND', message: 'race_gone_or_full' })
      return { ...joined, you: ctx.user.id }
    }),

    room: protectedProcedure.input(z.object({ code })).query(({ ctx, input }) => inRoom(input.code, ctx.user.id)),

    send: protectedProcedure.input(z.object({ code, to: z.string().max(128), kind: z.enum(['offer', 'answer']), sdp }))
      .mutation(async ({ ctx, input }) => {
        const { players } = await inRoom(input.code, ctx.user.id)
        if (!players.some((p) => p.id === input.to)) throw new TRPCError({ code: 'NOT_FOUND' })
        if (!(await sendMessage(input.code, input.to, { from: ctx.user.id, kind: input.kind, sdp: input.sdp }))) {
          throw new TRPCError({ code: 'TOO_MANY_REQUESTS' })
        }
        return { ok: true as const }
      }),

    inbox: protectedProcedure.input(z.object({ code })).mutation(async ({ ctx, input }) => {
      await inRoom(input.code, ctx.user.id)
      return takeMessages(input.code, ctx.user.id)
    }),
  }),
})
