#!/usr/bin/env node
// Recompute distanceMetres on every stored tracker recording.
//
// Until 2026-09 the upload stored a RAW sum of every GPS fix, so a tracker left
// sitting on a jetty "travelled" over a kilometre in ten minutes, and the
// tracker totals on the devices page were inflated. New uploads store the
// movement-gated distance (movementDistanceM in @paddlesnitch/timing/device);
// this rewrites the old ones the same way. Idempotent: a recording already at
// the right value is left alone.
//
// Dry run by default -- prints what would change. Add --apply to write.
//   DATA_BUCKET=paddlesnitch-data-prod AWS_PROFILE=paddlesnitch AWS_REGION=eu-west-1 \
//     npx tsx scripts/backfill-device-distance.ts [--apply]

import { realpathSync } from 'fs'
import { fileURLToPath } from 'url'
import { listKeys, getJson, putJson, getObject } from '../src/lib/storage'
import { parseTrace } from '@paddlesnitch/timing/parse'
import { movementDistanceM } from '@paddlesnitch/timing/device'
import type { DeviceSessionMeta } from '@paddlesnitch/core/devices'

// Pure helper (unit-tested): the gated distance for one stored trace, or null
// when the trace can't be parsed (left untouched).
export async function gatedDistanceFor(filename: string, csv: Buffer): Promise<number | null> {
  const parsed = await parseTrace(filename, csv.buffer.slice(csv.byteOffset, csv.byteOffset + csv.byteLength) as ArrayBuffer)
  if (!parsed.ok || parsed.track.length === 0) return null
  return Math.round(movementDistanceM(parsed.track.map(p => ({ lat: p.lat, lng: p.lng, tMs: p.timestamp.getTime() }))))
}

export async function run(apply: boolean): Promise<{ checked: number; changed: number }> {
  const metaKeys = (await listKeys('devices/')).filter(k => /\/sessions\/[^/]+\/session\.json$/.test(k))
  let checked = 0, changed = 0
  for (const key of metaKeys) {
    const meta = await getJson<DeviceSessionMeta>(key)
    const csv = meta && await getObject(key.replace(/session\.json$/, 'trace.csv'))
    if (!meta || !csv) continue
    checked++
    const next = await gatedDistanceFor(meta.filename, csv)
    if (next == null || next === meta.distanceMetres) continue
    changed++
    console.log(`${key}: ${meta.distanceMetres ?? '-'} m -> ${next} m`)
    if (apply) await putJson(key, { ...meta, distanceMetres: next })
  }
  console.log(`backfill-device-distance: ${changed} of ${checked} recording(s) ${apply ? 'rewritten' : 'would change (dry run; add --apply)'}.`)
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
