// What `pnpm mobile:contract` writes into mobile/contract/ for the Android and
// iPhone apps (docs/features/mobile-apps.md, phase C1): the API schema from
// @paddlesnitch/api/contract and the design tokens from @paddlesnitch/ui's
// tokens.css. Pure, so the contract test can compare it with what's committed.
import { apiContractFiles } from '@paddlesnitch/api/contract'
import { STRAVA_CONNECT_RESULTS } from './strava-connect-results'
import { CURRENT_TOS_VERSION } from './types'
import { fmtDur, fmtClock, split500, roundStrokes } from '@paddlesnitch/analysis/analysis'
import { fmtWeekday, fmtMonth, compassPoint, fmtDayTime } from '@paddlesnitch/core/format'
import { fmtDay as deviceDay, fmtDist, fmtAgo } from '@/lib/device-view'
import { paddleKm } from '@paddlesnitch/core/paddles'
import { noPaddleMessage, type NoPaddleReason } from '@paddlesnitch/timing/device'

export type DesignTokens = {
  color: Record<string, string>
  radius: Record<string, number>
  font: Record<string, string>
}

/** The colours, radii and font families from tokens.css, for the apps' themes. */
export function tokensFromCss(css: string): DesignTokens {
  const tokens: DesignTokens = { color: {}, radius: {}, font: {} }
  for (const [, group, name, value] of css.matchAll(/--(color|radius|font)-([a-z0-9-]+):\s*([^;]+);/g)) {
    if (group === 'color') tokens.color[name] = value.trim()
    // Only plain pixel radii; the apps scale them themselves.
    else if (group === 'radius') tokens.radius[name] = parseFloat(value)
    // The first quoted family: the web's next/font variable means nothing to an app.
    else tokens.font[name] = /"([^"]+)"/.exec(value)?.[1] ?? value.trim()
  }
  return tokens
}

/**
 * How the website writes the numbers, dates and messages both apps show:
 * function name → cases of { in, out }, each `out` produced by calling the
 * website's own function on `in` (described in mobile/contract/README.md).
 * The apps run their ports over every case, so all three say the same thing.
 * Pick inputs at the edges, where a port goes wrong: rounding at :59.5,
 * toFixed on a float like 1.005 and on an exact tie like 0.125, the compass
 * boundary at 22.5°.
 */
export function formatCases() {
  const cases = <I, O>(fn: (i: I) => O, inputs: I[]) => inputs.map(i => ({ in: i, out: fn(i) }))
  const lost = (lostAfterS: number): NoPaddleReason => ({ kind: 'gps_lost', lostAfterS, recordedS: 7200 })
  return {
    fmtDur: cases(fmtDur, [0, 0.4, 59.4, 59.5, 119.6, 125.4, 600, 3599.6]),
    fmtClock: cases(fmtClock, [0, 59.5, 185, 3599.5, 3600, 3725, 36000]),
    split500: cases(split500, [0, 0.2, 0.21, 3.0269791402084816, 500 / 119.6, 4.5]),
    fmtWeekday: cases(fmtWeekday, ['2026-09-13T07:30:00.000Z', '2026-09-14T00:30:00+01:00', '2024-02-29T12:00:00Z', 'not a date']),
    fmtMonth: cases(fmtMonth, ['2026-09-01T07:30:00.000Z', '2026-12-31T23:59:59.999Z', '2027-01-01T00:30:00+01:00', 'not a date']),
    paddleKm: cases((p: { distanceKm: number; noGps?: true }) => paddleKm(p), [
      // 0.125 is an exact tie: JavaScript rounds it up (0.13), C's printf to even (0.12).
      { distanceKm: 4.2478 }, { distanceKm: 1.005 }, { distanceKm: 0.125 }, { distanceKm: 0 }, { distanceKm: 0, noGps: true }, { distanceKm: 3.2, noGps: true },
    ]),
    compassPoint: cases(compassPoint, [0, 22.4, 22.5, 22.6, 225, 337.5, 350, 360, -10]),
    noPaddleMessage: cases((i: { reason: NoPaddleReason; hasMotion: boolean }) => noPaddleMessage(i.reason, i.hasMotion), [
      { reason: { kind: 'no_gps', recordedS: 1800 }, hasMotion: true },
      { reason: { kind: 'no_gps', recordedS: 1800 }, hasMotion: false },
      // 8100 s = 2.25 h, an exact tie for toFixed(1): 2.3, not 2.2.
      ...[0.4, 89, 90, 5399, 5400, 8100, 9000].map(s => ({ reason: lost(s), hasMotion: true })),
      { reason: { kind: 'too_short', movedM: 12, minM: 100 }, hasMotion: true },
    ]),
    roundStrokes: cases(roundStrokes, [0, 7, 999, 1000, 1049, 1050, 12345, 1234567]),
    // The tracker pages (lib/device-view.ts). null = no value ("never", "—").
    fmtDay: cases((i: string | null) => deviceDay(i ?? undefined), ['2026-09-13T07:30:00.000Z', '2026-09-14T00:30:00+01:00', '2026-09-13', null]),
    fmtDist: cases((m: number | null) => fmtDist(m ?? undefined), [null, 0, 999.4, 999.5, 1000, 1234.5, 1005, 84210]),
    // fmtAgo counts back from `now` (both ISO): seconds below 90, minutes below 90, hours below 48, then days.
    fmtAgo: cases((i: { at: string | null; now: string }) => fmtAgo(i.at ?? undefined, Date.parse(i.now)),
      [0, 89, 90, 5399, 5400, 172799, 172800, 864000, -60].map(s => ({ at: new Date(Date.parse('2026-10-25T12:00:00Z') - s * 1000).toISOString(), now: '2026-10-25T12:00:00Z' }))
        .concat([{ at: null, now: '2026-10-25T12:00:00Z' }, { at: 'not a date', now: '2026-10-25T12:00:00Z' }])),
    // In the viewer's time zone, given as `zone` (IANA name).
    fmtDayTime: cases((i: { at: string; zone: string }) => inZone(i.zone, () => fmtDayTime(i.at)), [
      { at: '2026-09-13T07:05:00Z', zone: 'UTC' },
      { at: '2026-09-13T07:05:00Z', zone: 'Europe/London' },
      { at: '2026-10-25T00:30:00Z', zone: 'Europe/London' },
      { at: '2026-10-25T01:30:00Z', zone: 'Europe/London' },
      { at: '2026-12-31T23:59:00Z', zone: 'Atlantic/Reykjavik' },
      { at: '2026-12-31T23:59:00Z', zone: 'Europe/Berlin' },
      { at: 'not a date', zone: 'UTC' },
    ]),
  }
}

// Runs fn with the process in another time zone (Node reads TZ on each change).
function inZone<T>(zone: string, fn: () => T): T {
  const before = process.env.TZ
  process.env.TZ = zone
  try { return fn() } finally {
    if (before === undefined) delete process.env.TZ
    else process.env.TZ = before
  }
}

/** Every file under mobile/contract/ that is generated, path → content. */
export function mobileContractFiles(tokensCss: string): Record<string, string> {
  const files: Record<string, string> = {}
  for (const [name, content] of Object.entries(apiContractFiles())) files[`api/${name}`] = content
  // Values the apps must send as the server expects them: the Terms version a
  // new account agrees to (sign-up refuses any other with a 422).
  files['api/constants.json'] = JSON.stringify({
    tosVersion: CURRENT_TOS_VERSION,
    // How connecting Strava can end, with the website's words for each.
    stravaConnectResults: Object.fromEntries(Object.entries(STRAVA_CONNECT_RESULTS).map(([k, v]) => [k, v.text])),
  }, null, 2) + '\n'
  files['tokens/tokens.json'] = JSON.stringify(tokensFromCss(tokensCss), null, 2) + '\n'
  files['format/format.json'] = JSON.stringify(formatCases(), null, 2) + '\n'
  return files
}
