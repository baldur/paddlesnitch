// What `pnpm mobile:contract` writes into mobile/contract/ for the Android and
// iPhone apps (docs/features/mobile-apps.md, phase C1): the API schema from
// @paddlesnitch/api/contract and the design tokens from @paddlesnitch/ui's
// tokens.css. Pure, so the contract test can compare it with what's committed.
import { apiContractFiles } from '@paddlesnitch/api/contract'
import { fmtDur, fmtClock, split500 } from '@paddlesnitch/analysis/analysis'
import { fmtWeekday, fmtMonth, compassPoint } from '@paddlesnitch/core/format'
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
 * toFixed on a float like 1.005, the compass boundary at 22.5°.
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
      { distanceKm: 4.2478 }, { distanceKm: 1.005 }, { distanceKm: 0 }, { distanceKm: 0, noGps: true }, { distanceKm: 3.2, noGps: true },
    ]),
    compassPoint: cases(compassPoint, [0, 22.4, 22.5, 22.6, 225, 337.5, 350, 360, -10]),
    noPaddleMessage: cases((i: { reason: NoPaddleReason; hasMotion: boolean }) => noPaddleMessage(i.reason, i.hasMotion), [
      { reason: { kind: 'no_gps', recordedS: 1800 }, hasMotion: true },
      { reason: { kind: 'no_gps', recordedS: 1800 }, hasMotion: false },
      ...[0.4, 89, 90, 5399, 5400, 9000].map(s => ({ reason: lost(s), hasMotion: true })),
      { reason: { kind: 'too_short', movedM: 12, minM: 100 }, hasMotion: true },
    ]),
  }
}

/** Every file under mobile/contract/ that is generated, path → content. */
export function mobileContractFiles(tokensCss: string): Record<string, string> {
  const files: Record<string, string> = {}
  for (const [name, content] of Object.entries(apiContractFiles())) files[`api/${name}`] = content
  files['tokens/tokens.json'] = JSON.stringify(tokensFromCss(tokensCss), null, 2) + '\n'
  files['format/format.json'] = JSON.stringify(formatCases(), null, 2) + '\n'
  return files
}
