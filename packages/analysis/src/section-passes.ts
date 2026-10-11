// Every pass through a section (docs/features/buddies-and-compare.md, part B):
// two gates on a paddle's line, and every time you or a buddy paddled through
// them the same way: laps and repeat passes in one outing each count. For
// your best, your trend, and comparing any two passes line against line.
//
// Server-side: reads paddles. Buddies' paddles only through the buddy rules
// (sharing on, not hidden), checked here once per buddy and per paddle.
import { allPasses, crossingSignNear, haversine } from '@paddlesnitch/timing/geo'
import type { Line } from '@paddlesnitch/timing/types'
import { listBuddies, getBuddySharing, canViewPaddle } from '@paddlesnitch/core/buddies'
import type { AnalysisPoint } from './analysis'
import { getSession, getRouteCells, listSessionSummaries, type AnalysisSession } from './analysis-store'
import { gateAt, pointsToTrack, pathSimilarity, COVERAGE_MIN, MIN_SECTION_M } from './similar'
import { routeCells, cellOverlap } from './route-match'

/** A paddle's route must pass through this much of the section's squares to be checked. */
const SECTION_OVERLAP = 0.7

export type Section = { startLine: Line; finishLine: Line; startSign?: number; finishSign?: number; sectionM: number; path: [number, number][] }

export type SectionPass = {
  owner: string            // the paddle's owner (you, or a buddy)
  paddleId: string
  paddledAt: string
  n: number                // which pass in that paddle (1, 2, …)
  startT: number; finishT: number   // seconds from the paddle's start
  elapsedS: number
  metres: number           // the line actually paddled between the gates
  avgSR: number | null
}

const lengthM = (pts: { lat: number; lng: number }[]) => pts.slice(1).reduce((d, p, i) => d + haversine([pts[i].lat, pts[i].lng], [p.lat, p.lng]), 0)

/** The section between two points of a paddle's line (in paddling order), its gates and direction. */
export function sectionOf(points: AnalysisPoint[], aIdx: number, bIdx: number): Section | null {
  const [i0, i1] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx]
  if (i0 < 0 || i1 >= points.length) return null
  const slice = points.slice(i0, i1 + 1)
  const sectionM = lengthM(slice)
  if (sectionM < MIN_SECTION_M) return null
  const startLine = gateAt(points, i0), finishLine = gateAt(points, i1)
  const track = pointsToTrack(points)
  return {
    startLine, finishLine, sectionM, path: slice.map(p => [p.lat, p.lng]),
    startSign: crossingSignNear(track, startLine, i0), finishSign: crossingSignNear(track, finishLine, i1),
  }
}

/** Every pass of one paddle through the section, the same way, along the same water. */
export function passesIn(owner: string, s: AnalysisSession, sec: Section): SectionPass[] {
  const pts = s.result.points
  const passes = allPasses(pointsToTrack(pts), sec.startLine, sec.finishLine, sec.startSign, sec.finishSign)
  const out: SectionPass[] = []
  for (const p of passes) {
    const startT = p.startMs / 1000, finishT = p.finishMs / 1000
    const between = pts.filter(q => q.t >= startT && q.t <= finishT)
    // Through both gates but by another channel isn't this section.
    if (pathSimilarity(sec.path, between.map(q => [q.lat, q.lng])) < COVERAGE_MIN) continue
    const srs = between.map(q => q.sr).filter((x): x is number => x != null)
    out.push({
      owner, paddleId: s.id, paddledAt: s.paddledAt, n: out.length + 1, startT, finishT,
      elapsedS: finishT - startT, metres: lengthM(between),
      avgSR: srs.length ? srs.reduce((a, b) => a + b, 0) / srs.length : null,
    })
  }
  return out
}

/** The points of one pass (and one either side), for the line comparison. */
export function passLine(s: AnalysisSession, p: Pick<SectionPass, 'startT' | 'finishT'>): AnalysisPoint[] {
  return s.result.points.filter(q => q.t >= p.startT - 1 && q.t <= p.finishT + 1)
}

/**
 * Every pass of the section by `viewerId` and their buddies (whose paddles
 * they may see), fastest first.
 */
export async function sectionPasses(viewerId: string, sec: Section): Promise<SectionPass[]> {
  const sectionCells = routeCells(sec.path.map(([lat, lng]) => ({ lat, lng })))
  const owners = [viewerId]
  for (const b of await listBuddies(viewerId)) if ((await getBuddySharing(b.userId)).paddles) owners.push(b.userId)
  const perOwner = await Promise.all(owners.map(async owner => {
    const summaries = (await listSessionSummaries(owner)).filter(s => owner === viewerId || !s.hiddenFromBuddies)
    const near = (await Promise.all(summaries.map(async s => ({ s, ok: cellOverlap(sectionCells, await getRouteCells(owner, s.id)) >= SECTION_OVERLAP }))))
      .filter(x => x.ok).map(x => x.s)
    const found = await Promise.all(near.map(async sum => {
      const full = await getSession(owner, sum.id)
      // The rule itself, once more per paddle: nothing slips through a stale summary.
      if (!full || !(await canViewPaddle(viewerId, owner, full))) return []
      return passesIn(owner, full, sec)
    }))
    return found.flat()
  }))
  return onePerOuting(perOwner.flat()).sort((x, y) => x.elapsedS - y.elapsedS)
}

/** One outing recorded twice (tracker and Strava) passes the gates twice at the
 *  same clock time: keep one, preferring the recording with stroke rate. */
function onePerOuting(passes: SectionPass[]): SectionPass[] {
  const clock = (p: SectionPass) => Date.parse(p.paddledAt) / 1000 + p.startT
  const kept: SectionPass[] = []
  for (const p of [...passes].sort((x, y) => Number(y.avgSR != null) - Number(x.avgSR != null))) {
    if (!kept.some(k => k.owner === p.owner && k.paddleId !== p.paddleId && Math.abs(clock(k) - clock(p)) < 90)) kept.push(p)
  }
  return kept
}
