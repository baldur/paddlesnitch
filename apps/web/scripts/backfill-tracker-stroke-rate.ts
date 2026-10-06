#!/usr/bin/env node
// Re-analyse every tracker paddle with stroke rate from its motion data
// (docs/features/one-paddle.md, phase 1).
//
// Tracker paddles were analysed from the GPS columns only, so they have no
// stroke rate. This loads each one's recording the way new paddles are now
// loaded (loadDeviceSessionTrack, which adds the stroke rate) and re-runs the
// analysis. It keeps the diary note, boat class and written summary; the
// summary is rewritten when phase 2 re-analyses paddles as their motion data
// arrives. Stroke-rate doubling is turned off: the tracker counts every stroke.
// A paddle whose recording has no motion data is left alone.
//
// Dry run by default -- prints what would change. Add --apply to write.
//   DATA_BUCKET=paddlesnitch-data-prod AWS_PROFILE=paddlesnitch AWS_REGION=eu-west-1 \
//     npx tsx scripts/backfill-tracker-stroke-rate.ts [--apply]

import { realpathSync } from 'fs'
import { fileURLToPath } from 'url'
import { listKeys, getJson, putJson } from '../src/lib/storage'
import { loadDeviceSessionTrack } from '@paddlesnitch/analysis/device-sessions'
import { analyseTrack } from '@paddlesnitch/analysis/analysis'
import type { AnalysisSession } from '@paddlesnitch/analysis/analysis-store'
import type { TrackPoint } from '@paddlesnitch/timing/types'

// Pure helper (unit-tested): the paddle re-analysed from a track that carries
// stroke rate, or null when the track has none (nothing to gain).
export function reanalysed(s: AnalysisSession, track: TrackPoint[]): AnalysisSession | null {
  if (!track.some(p => p.strokeRate != null)) return null
  const result = analyseTrack(track, { doubleStrokeRate: false, conditions: s.result.conditions })
  return {
    ...s,
    doubleStrokeRate: false,
    result: { ...result, insight: s.result.insight, insightModel: s.result.insightModel },
  }
}

export async function run(apply: boolean): Promise<{ checked: number; changed: number }> {
  const keys = (await listKeys('analysis/')).filter(k => /^analysis\/[^/]+\/[^/]+\/session\.json$/.test(k))
  let checked = 0, changed = 0
  for (const key of keys) {
    const s = await getJson<AnalysisSession>(key)
    const src = s?.source
    if (!s || src?.type !== 'device' || !src.deviceId || !src.deviceSessionId) continue
    checked++
    const track = await loadDeviceSessionTrack(s.userId, src.deviceId, src.deviceSessionId)
    const next = track && reanalysed(s, track)
    if (!next) { console.log(`${key}: no motion data, left alone`); continue }
    changed++
    const sr = next.result.avgSR != null ? `${Math.round(next.result.avgSR)} spm` : '-'
    console.log(`${key}: stroke rate ${s.result.avgSR ?? '-'} -> ${sr}${s.doubleStrokeRate ? ' (doubling turned off)' : ''}`)
    if (apply) await putJson(key, next)
  }
  console.log(`backfill-tracker-stroke-rate: ${changed} of ${checked} tracker paddle(s) ${apply ? 'rewritten' : 'would change (dry run; add --apply)'}.`)
  return { checked, changed }
}

const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  run(process.argv.includes('--apply')).catch(err => {
    console.error(err)
    process.exit(1)
  })
}
