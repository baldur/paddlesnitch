// Cross-history intelligence for the LLM commentary. Two deterministic layers
// (no LLM, no extra tokens beyond a compact text block):
//   L1 — aggregates: how THIS paddle sits against the paddler's whole history
//        (PBs, vs-average, trends, volume, milestones).
//   L3 — retrieval: the few most RELEVANT past paddles (same venue/boat/effort).
// The model narrates these facts; it never computes them. See
// docs/features/personable-insights.md.
import { haversine } from '@paddlesnitch/timing/geo'
import { split500 } from './analysis'
import type { SessionSummary } from './analysis-store'
import type { BoatClass } from '@paddlesnitch/core/types'

// The minimal shape both a saved SessionSummary and the current (unsaved) paddle
// satisfy. SessionSummary is assignable to this.
export type PaddleFacts = {
  paddledAt: string
  cruiseSpeed: number        // m/s (higher = faster)
  distanceKm: number
  avgSR: number | null
  avgDps: number | null
  boatClass?: BoatClass
  startLat?: number
  startLng?: number
}

const DAY = 86_400_000
const VENUE_M = 500          // start points within this = "same venue"
const daysBetween = (a: string, b: Date) => (b.getTime() - new Date(a).getTime()) / DAY
const paceSec = (speed: number) => (speed > 0.2 ? 500 / speed : Infinity) // sec/500
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
const slope = (xs: number[], ys: number[]) => {
  const mx = mean(xs), my = mean(ys); let n = 0, d = 0
  xs.forEach((x, i) => { n += (x - mx) * (ys[i] - my); d += (x - mx) ** 2 })
  return d ? n / d : 0
}

export type HistoryStats = {
  priorCount: number
  vs90dPaceDeltaSec: number | null   // this paddle's sec/500 minus the 90-day avg; <0 = faster
  isCruisePB: boolean                // fastest cruise pace of ALL their paddles (incl. this)
  isClassPB: boolean                 // fastest for this boat class
  cruiseRank: number | null          // 1 = fastest ever (among all paddles incl. this)
  paceTrend: 'improving' | 'steady' | 'slipping' | null // over recent paddles
  distanceThisWeekKm: number
  distanceThisMonthKm: number
  sessionsThisWeek: number           // incl. this paddle
  daysSinceLast: number | null
  cumulativeDistanceKm: number       // incl. this paddle
  crossedMilestoneKm: number | null  // a 50 km multiple this paddle just pushed past
}

// `prior` = the paddler's already-saved paddles (this one is NOT in it).
export function computeHistoryStats(current: PaddleFacts, prior: SessionSummary[], now: Date): HistoryStats {
  const priorCount = prior.length
  const all: PaddleFacts[] = [...prior, current]
  const currentPace = paceSec(current.cruiseSpeed)

  // vs 90-day average cruise pace (of prior paddles within 90d of this one)
  const ref = new Date(current.paddledAt)
  const recent90 = prior.filter(p => Math.abs(daysBetween(p.paddledAt, ref)) <= 90 && p.cruiseSpeed > 0.2)
  const avg90Pace = recent90.length ? mean(recent90.map(p => paceSec(p.cruiseSpeed))) : null
  const vs90dPaceDeltaSec = avg90Pace != null && isFinite(currentPace) ? currentPace - avg90Pace : null

  // PBs + rank vs the PRIOR paddles (faster = lower sec/500).
  const priorMoving = prior.filter(p => p.cruiseSpeed > 0.2)
  const fasterPriors = isFinite(currentPace) ? priorMoving.filter(p => paceSec(p.cruiseSpeed) < currentPace - 1e-6).length : priorMoving.length
  const cruiseRank = isFinite(currentPace) && priorMoving.length >= 1 ? fasterPriors + 1 : null
  const isCruisePB = isFinite(currentPace) && priorMoving.length >= 2 && fasterPriors === 0
  const classPriors = current.boatClass ? priorMoving.filter(p => p.boatClass === current.boatClass) : []
  const isClassPB = !!current.boatClass && classPriors.length >= 1 && isFinite(currentPace) &&
    classPriors.every(p => paceSec(p.cruiseSpeed) >= currentPace - 1e-6)

  // trend over the last ~10 paddles (incl. this): slope of pace vs time
  const recent = all.filter(p => p.cruiseSpeed > 0.2)
    .sort((a, b) => new Date(a.paddledAt).getTime() - new Date(b.paddledAt).getTime()).slice(-10)
  let paceTrend: HistoryStats['paceTrend'] = null
  if (recent.length >= 4) {
    const t0 = new Date(recent[0].paddledAt).getTime()
    const xs = recent.map(p => (new Date(p.paddledAt).getTime() - t0) / DAY)
    const ys = recent.map(p => paceSec(p.cruiseSpeed))
    const sl = slope(xs, ys) // sec/500 per day; negative = getting faster
    paceTrend = sl < -0.05 ? 'improving' : sl > 0.05 ? 'slipping' : 'steady'
  }

  // volume
  const inWindow = (p: PaddleFacts, days: number) => { const d = daysBetween(p.paddledAt, now); return d >= 0 && d <= days }
  const distanceThisWeekKm = all.filter(p => inWindow(p, 7)).reduce((s, p) => s + p.distanceKm, 0)
  const distanceThisMonthKm = all.filter(p => inWindow(p, 30)).reduce((s, p) => s + p.distanceKm, 0)
  const sessionsThisWeek = all.filter(p => inWindow(p, 7)).length
  const daysSinceLast = prior.length
    ? Math.min(...prior.map(p => Math.abs(daysBetween(p.paddledAt, ref)))) : null

  // cumulative distance + milestone (50 km multiples)
  const priorCumulative = prior.reduce((s, p) => s + p.distanceKm, 0)
  const cumulativeDistanceKm = priorCumulative + current.distanceKm
  const step = 50
  const crossedMilestoneKm = Math.floor(cumulativeDistanceKm / step) > Math.floor(priorCumulative / step)
    ? Math.floor(cumulativeDistanceKm / step) * step : null

  return {
    priorCount, vs90dPaceDeltaSec, isCruisePB, isClassPB, cruiseRank, paceTrend,
    distanceThisWeekKm, distanceThisMonthKm, sessionsThisWeek,
    daysSinceLast: daysSinceLast == null ? null : Math.round(daysSinceLast),
    cumulativeDistanceKm, crossedMilestoneKm,
  }
}

// A compact, grounded fact block for the prompt — only the NOTABLE facts, so the
// model has personal material without noise. Empty string if nothing stands out.
export function renderHistoryFacts(s: HistoryStats): string {
  if (s.priorCount === 0) return ''
  const L: string[] = []
  if (s.isClassPB) L.push('This is their FASTEST cruise pace ever in this boat class — a personal best.')
  else if (s.isCruisePB) L.push('This is their FASTEST cruise pace across all their saved paddles — a personal best.')
  else if (s.cruiseRank != null && s.cruiseRank <= 3 && s.priorCount >= 3) L.push(`One of their quickest paddles — ${ordinal(s.cruiseRank)} fastest cruise pace on record.`)
  if (s.vs90dPaceDeltaSec != null && Math.abs(s.vs90dPaceDeltaSec) >= 2) {
    const faster = s.vs90dPaceDeltaSec < 0
    L.push(`Cruise pace was ${Math.abs(s.vs90dPaceDeltaSec).toFixed(0)}s/500 ${faster ? 'FASTER' : 'slower'} than their 90-day average.`)
  }
  if (s.paceTrend === 'improving') L.push('Their cruise pace has been trending FASTER over recent paddles.')
  else if (s.paceTrend === 'slipping') L.push('Their cruise pace has drifted slightly slower over recent paddles.')
  if (s.daysSinceLast != null) {
    if (s.daysSinceLast >= 14) L.push(`First paddle back after ${s.daysSinceLast} days off.`)
    else if (s.sessionsThisWeek >= 3) L.push(`A busy week — ${s.sessionsThisWeek} paddles in the last 7 days.`)
  }
  if (s.distanceThisMonthKm >= 5) L.push(`They've covered ${s.distanceThisMonthKm.toFixed(0)} km in the last 30 days.`)
  if (s.crossedMilestoneKm != null) L.push(`This paddle pushed their all-time logged distance past ${s.crossedMilestoneKm} km.`)
  return L.length ? `\nHow this paddle sits in their history:\n${L.map(x => `  - ${x}`).join('\n')}` : ''
}

function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`
}

// ---- L3: relevance retrieval ----

export type RelevantPaddle = { summary: SessionSummary; reason: string }

// Rank prior paddles by relevance to the current one — same venue (start point
// nearby), same boat class, similar distance — and return the top `n`. More
// meaningful for the narrative than the chronological last-N.
export function selectRelevantPaddles(current: PaddleFacts, prior: SessionSummary[], n = 3): RelevantPaddle[] {
  const scored = prior.map(p => {
    let score = 0
    const reasons: string[] = []
    if (current.startLat != null && current.startLng != null && p.startLat != null && p.startLng != null) {
      const d = haversine([current.startLat, current.startLng], [p.startLat, p.startLng])
      if (d <= VENUE_M) { score += 3; reasons.push('same spot') }
    }
    if (current.boatClass && p.boatClass === current.boatClass) { score += 2; reasons.push(current.boatClass) }
    if (current.distanceKm > 0 && p.distanceKm > 0) {
      const ratio = Math.min(current.distanceKm, p.distanceKm) / Math.max(current.distanceKm, p.distanceKm)
      if (ratio >= 0.8) { score += 1; reasons.push('similar distance') }
    }
    return { summary: p, score, reason: reasons.join(', ') }
  }).filter(x => x.score > 0)
  scored.sort((a, b) => b.score - a.score || (b.summary.paddledAt > a.summary.paddledAt ? 1 : -1))
  return scored.slice(0, n).map(({ summary, reason }) => ({ summary, reason }))
}

export function renderRelevant(list: RelevantPaddle[]): string {
  if (!list.length) return ''
  const lines = list.map(({ summary: h, reason }) => {
    const d = h.paddledAt?.slice(0, 10) ?? '?'
    const bits = [`${d}: ${h.distanceKm.toFixed(1)}km`, `cruise ${split500(h.cruiseSpeed)}/500`]
    if (h.avgSR != null) bits.push(`${Math.round(h.avgSR)}spm`)
    let line = `  - ${bits.join(', ')}${reason ? ` (${reason})` : ''}.`
    if (h.note?.trim()) line += ` Note: "${h.note.trim().slice(0, 120)}"`
    return line
  })
  return `\nTheir most comparable past paddles:\n${lines.join('\n')}`
}
