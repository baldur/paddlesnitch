// Every pass through a section, yours and your buddies' (section-passes.ts).
// The section is either picked on a paddle you may see (yours, or a buddy's)
// or one you saved (#435, yours only); each pass comes from a paddle you may
// see. Names, never emails; "You" for yours.
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import { canViewPaddle } from '@paddlesnitch/core/buddies'
import { isMotionOnly } from '@paddlesnitch/core/paddles'
import { findUserBySub } from '@paddlesnitch/core/cognito'
import { getSession } from '@paddlesnitch/analysis/analysis-store'
import { sectionOf, sectionPasses, passesIn, passLine } from '@paddlesnitch/analysis/section-passes'
import {
  saveSection, getSavedSection, listSavedSections, renameSavedSection, deleteSavedSection, asSection, MAX_NAME,
} from '@paddlesnitch/analysis/saved-sections'

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const picked = z.object({ sourceId: id, owner: id.optional(), aIdx: z.number().int().min(0), bIdx: z.number().int().min(0) })
const where = z.union([picked, z.object({ sectionId: id })])
const name = z.string().trim().min(1).max(MAX_NAME)
// Enough points for a thumbnail.
const thin = (path: [number, number][], max = 60) => path.filter((_, i) => i % Math.ceil(path.length / max) === 0 || i === path.length - 1)

async function pickedSection(viewer: string, input: z.infer<typeof picked>) {
  const owner = input.owner ?? viewer
  const src = await getSession(owner, input.sourceId)
  // A paddle without a map (#414) has no section to pick.
  if (!src || isMotionOnly(src.result) || !(await canViewPaddle(viewer, owner, src))) throw new TRPCError({ code: 'NOT_FOUND' })
  const sec = sectionOf(src.result.points, input.aIdx, input.bIdx)
  if (!sec) throw new TRPCError({ code: 'BAD_REQUEST', message: 'section_too_short' })
  return sec
}

async function sectionFrom(viewer: string, input: z.infer<typeof where>) {
  if ('sectionId' in input) {
    const saved = await getSavedSection(viewer, input.sectionId)
    if (!saved) throw new TRPCError({ code: 'NOT_FOUND' })
    return { sec: asSection(saved), saved }
  }
  return { sec: await pickedSection(viewer, input), saved: null }
}

export const sectionsRouter = router({
  passes: protectedProcedure.input(where).query(async ({ ctx, input }) => {
    const { sec, saved } = await sectionFrom(ctx.user.id, input)
    const passes = await sectionPasses(ctx.user.id, sec)
    const names = new Map<string, string>([[ctx.user.id, 'You']])
    for (const o of new Set(passes.map(p => p.owner))) {
      if (!names.has(o)) names.set(o, (await findUserBySub(o))?.displayName || 'A buddy')
    }
    return {
      saved: saved && { id: saved.id, name: saved.name },
      sectionM: sec.sectionM, startLine: sec.startLine, finishLine: sec.finishLine, path: sec.path,
      passes: passes.map(p => ({ ...p, mine: p.owner === ctx.user.id, name: names.get(p.owner)!, paceS500: p.elapsedS / (sec.sectionM / 500) })),
    }
  }),

  // One pass's line, to compare two passes on the map.
  passLine: protectedProcedure.input(z.object({ where, paddleOwner: id, paddleId: id, n: z.number().int().min(1) })).query(async ({ ctx, input }) => {
    const { sec } = await sectionFrom(ctx.user.id, input.where)
    const s = await getSession(input.paddleOwner, input.paddleId)
    if (!s || !(await canViewPaddle(ctx.user.id, input.paddleOwner, s))) throw new TRPCError({ code: 'NOT_FOUND' })
    const pass = passesIn(input.paddleOwner, s, sec).find(p => p.n === input.n)
    if (!pass) throw new TRPCError({ code: 'NOT_FOUND' })
    return passLine(s, pass).map(q => ({ t: q.t, lat: q.lat, lng: q.lng, speed: q.speed, sr: q.sr, dps: q.dps }))
  }),

  // Saved sections (#435): private to the paddler who saved them.
  save: protectedProcedure.input(picked.extend({ name })).mutation(async ({ ctx, input }) => {
    const saved = await saveSection(ctx.user.id, input.name, await pickedSection(ctx.user.id, input))
    if (saved === 'too_many') throw new TRPCError({ code: 'BAD_REQUEST', message: 'too_many_sections' })
    return { id: saved.id }
  }),

  list: protectedProcedure.query(async ({ ctx }) =>
    (await listSavedSections(ctx.user.id)).map(s => ({ id: s.id, name: s.name, distanceMetres: s.distanceMetres, path: thin(s.path), createdAt: s.createdAt }))),

  rename: protectedProcedure.input(z.object({ sectionId: id, name })).mutation(async ({ ctx, input }) => {
    if (!(await renameSavedSection(ctx.user.id, input.sectionId, input.name))) throw new TRPCError({ code: 'NOT_FOUND' })
    return { ok: true }
  }),

  remove: protectedProcedure.input(z.object({ sectionId: id })).mutation(async ({ ctx, input }) => {
    if (!(await deleteSavedSection(ctx.user.id, input.sectionId))) throw new TRPCError({ code: 'NOT_FOUND' })
    return { ok: true }
  }),
})
