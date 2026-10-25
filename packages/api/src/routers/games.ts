// The kayak game (games/kayak): a leaderboard per course, and making and joining
// live races, whose messages then go through the relay (docs/features/game-accounts-leaderboard-live.md).
// Plain JSON over tRPC: the game is static files on the same origin, so it calls
// these with fetch and the visitor's sign-in cookie.
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { findUserBySub } from '@paddlesnitch/core/cognito'
import {
  GAME_BOATS, GAME_COURSES, GAME_HULLS, createRoom, getGameKit, getLeaderboard, getRoom, joinRoom, listPlayers,
  plausible, putGameKit, relayTicket, shortName, submitResult, type GameCourse,
} from '@paddlesnitch/core/games'
import { router, publicProcedure, protectedProcedure } from '../trpc'

const course = z.enum(Object.keys(GAME_COURSES) as [GameCourse, ...GameCourse[]])
const code = z.string().regex(/^[A-Z]{4}$/)
const colour = z.string().regex(/^#[0-9a-f]{6}$/)
const kit = z.object({
  skin: colour, head: z.enum(['cap', 'hair']), headColour: colour, sleeves: z.enum(['short', 'long']), top: colour,
  glasses: z.enum(['none', 'wrap', 'round', 'aviator', 'square']), glassesColour: colour,
  boat: z.enum(GAME_BOATS), deck: colour, stripe: colour, deckShape: z.enum(['modern', 'wings']), hullShape: z.enum(['round', 'vee']),
}).strict()

// The account's name (the sign-in token's copy can lag behind), shortened.
async function nameOf(user: { id: string; displayName?: string }) {
  return shortName((await findUserBySub(user.id).catch(() => null))?.displayName || user.displayName)
}

// Where the relay is, and a ticket to connect to it. RELAY_URL is the relay's
// WebSocket address (set by the stack); unset, as locally, the game uses
// /live on its own origin (games/tests/site.mjs serves one there).
async function relay(code: string, player: { id: string; name: string }) {
  return { url: process.env.RELAY_URL || null, ticket: await relayTicket(code, player) }
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

  // Your paddler and boat, so they follow you to another device. null until saved.
  kit: router({
    get: protectedProcedure.query(({ ctx }) => getGameKit(ctx.user.id)),
    set: protectedProcedure.input(kit).mutation(async ({ ctx, input }) => {
      await putGameKit(ctx.user.id, input)
      return input
    }),
  }),

  live: router({
    create: protectedProcedure.input(z.object({ course })).mutation(async ({ ctx, input }) => {
      const me = { id: ctx.user.id, name: await nameOf(ctx.user) }
      const room = await createRoom(input.course, me)
      return { room, players: await listPlayers(room.code), you: me.id, relay: await relay(room.code, me) }
    }),

    join: protectedProcedure.input(z.object({ code })).mutation(async ({ ctx, input }) => {
      const me = { id: ctx.user.id, name: await nameOf(ctx.user) }
      const joined = await joinRoom(input.code, me)
      if (!joined) throw new TRPCError({ code: 'NOT_FOUND', message: 'race_gone_or_full' })
      return { ...joined, you: me.id, relay: await relay(input.code, me) }
    }),

    // A fresh ticket, to reconnect after the connection dropped (a phone's screen locking, say).
    ticket: protectedProcedure.input(z.object({ code })).mutation(async ({ ctx, input }) => {
      if (!(await getRoom(input.code))) throw new TRPCError({ code: 'NOT_FOUND', message: 'race_gone' })
      const players = await listPlayers(input.code)
      const me = players.find((p) => p.id === ctx.user.id)
      if (!me) throw new TRPCError({ code: 'FORBIDDEN' })
      return relay(input.code, me)
    }),
  }),
})
