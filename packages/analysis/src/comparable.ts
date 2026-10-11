// Your paddles worth comparing with a given paddle (yours or a buddy's), best
// first, with why (route-match.ts has the rules). Server-side: it reads your
// paddles' squares and, for a shortlist, their points.
import { listSessionSummaries, getSession, getRouteCells, type AnalysisSession } from './analysis-store'
import { sharedSameWayM } from './line-compare'
import { timeOverlapShare, MIN_TIME_OVERLAP } from './same-outing'
import { resampleLine, routeCells, cellOverlap, comparability, SHORTLIST_OVERLAP, type Comparability } from './route-match'

/** At most this many get the exact (slower) comparison. */
const SHORTLIST_MAX = 25

export type ComparablePaddle = { id: string; paddledAt: string; distanceKm: number } & Comparability

export async function comparablePaddles(userId: string, target: AnalysisSession, limit = 12): Promise<ComparablePaddle[]> {
  const targetLine = resampleLine(target.result.points)
  const targetCells = routeCells(target.result.points)
  const window = { paddledAt: target.paddledAt, durationS: target.result.durationS }
  const mine = (await listSessionSummaries(userId)).filter(s => !(s.id === target.id && target.userId === userId))

  // Stage 1: paddled together, or enough of the same squares.
  const scored = await Promise.all(mine.map(async s => ({
    s,
    together: timeOverlapShare(window, s) >= MIN_TIME_OVERLAP,
    overlap: cellOverlap(targetCells, await getRouteCells(userId, s.id)),
  })))
  const shortlist = scored
    .filter(x => x.together || x.overlap >= SHORTLIST_OVERLAP)
    .sort((x, y) => Number(y.together) - Number(x.together) || y.overlap - x.overlap)
    .slice(0, SHORTLIST_MAX)

  // Stage 2: the exact shared same-direction stretch.
  const out = await Promise.all(shortlist.map(async ({ s, together }) => {
    const full = await getSession(userId, s.id)
    if (!full) return null
    const sharedM = sharedSameWayM(targetLine, resampleLine(full.result.points))
    const verdict = comparability({ together, sharedM, aKm: target.result.distanceKm, bKm: s.distanceKm })
    return verdict ? { id: s.id, paddledAt: s.paddledAt, durationS: s.durationS, distanceKm: s.distanceKm, ...verdict } : null
  }))
  // One outing recorded twice (tracker and Strava) is offered once: the
  // better-scoring recording.
  const ranked = out.filter((x): x is ComparablePaddle & { durationS: number } => !!x)
    .sort((x, y) => y.score - x.score || (x.paddledAt < y.paddledAt ? 1 : -1))
  const kept: typeof ranked = []
  for (const x of ranked) if (!kept.some(k => timeOverlapShare(k, x) >= MIN_TIME_OVERLAP)) kept.push(x)
  return kept.slice(0, limit).map(({ durationS: _, ...x }) => x)
}
