// Every pass through a section, yours and your buddies' (section-passes.ts).
// The section comes from a paddle you may see (yours, or a buddy's); each pass
// from a paddle you may see. Names, never emails; "You" for yours.
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import { canViewPaddle } from '@paddlesnitch/core/buddies'
import { findUserBySub } from '@paddlesnitch/core/cognito'
import { getSession } from '@paddlesnitch/analysis/analysis-store'
import { sectionOf, sectionPasses, passesIn, passLine } from '@paddlesnitch/analysis/section-passes'

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const where = z.object({ sourceId: id, owner: id.optional(), aIdx: z.number().int().min(0), bIdx: z.number().int().min(0) })

async function sectionFrom(viewer: string, input: z.infer<typeof where>) {
  const owner = input.owner ?? viewer
  const src = await getSession(owner, input.sourceId)
  if (!src || !(await canViewPaddle(viewer, owner, src))) throw new TRPCError({ code: 'NOT_FOUND' })
  const sec = sectionOf(src.result.points, input.aIdx, input.bIdx)
  if (!sec) throw new TRPCError({ code: 'BAD_REQUEST', message: 'section_too_short' })
  return sec
}

export const sectionsRouter = router({
  passes: protectedProcedure.input(where).query(async ({ ctx, input }) => {
    const sec = await sectionFrom(ctx.user.id, input)
    const passes = await sectionPasses(ctx.user.id, sec)
    const names = new Map<string, string>([[ctx.user.id, 'You']])
    for (const o of new Set(passes.map(p => p.owner))) {
      if (!names.has(o)) names.set(o, (await findUserBySub(o))?.displayName || 'A buddy')
    }
    return {
      sectionM: sec.sectionM, startLine: sec.startLine, finishLine: sec.finishLine, path: sec.path,
      passes: passes.map(p => ({ ...p, mine: p.owner === ctx.user.id, name: names.get(p.owner)!, paceS500: p.elapsedS / (sec.sectionM / 500) })),
    }
  }),

  // One pass's line, to compare two passes on the map.
  passLine: protectedProcedure.input(where.extend({ paddleOwner: id, paddleId: id, n: z.number().int().min(1) })).query(async ({ ctx, input }) => {
    const sec = await sectionFrom(ctx.user.id, input)
    const s = await getSession(input.paddleOwner, input.paddleId)
    if (!s || !(await canViewPaddle(ctx.user.id, input.paddleOwner, s))) throw new TRPCError({ code: 'NOT_FOUND' })
    const pass = passesIn(input.paddleOwner, s, sec).find(p => p.n === input.n)
    if (!pass) throw new TRPCError({ code: 'NOT_FOUND' })
    return passLine(s, pass).map(q => ({ t: q.t, lat: q.lat, lng: q.lng, speed: q.speed, sr: q.sr, dps: q.dps }))
  }),
})
