#!/usr/bin/env node
// Replace every stored time-trial upload with its parsed track.
//
// Until 2026-09 an entry kept the uploaded file byte for byte
// (trials/<t>/entries/<u>/<e>/trace.<gpx|fit|tcx|csv|zip>), heart rate and
// device serial numbers included, while the privacy page said heart rate is
// never stored. New uploads keep trace.csv written by trackToCsv (time,
// position, stroke rate). This rewrites the old ones the same way and deletes
// the original file. Strava snapshots (trace.json: positions and times only)
// are left alone. An entry whose file can't be parsed is reported and left.
//
// Dry run by default -- prints what would change. Add --apply to write.
//   DATA_BUCKET=paddlesnitch-data-prod AWS_PROFILE=paddlesnitch AWS_REGION=eu-west-1 \
//     npx tsx scripts/strip-trial-traces.ts [--apply]

import { realpathSync } from 'fs'
import { fileURLToPath } from 'url'
import { listKeys, getObject, putObject, deleteObject } from '../src/lib/storage'
import { parseTrace } from '@paddlesnitch/timing/parse'
import { trackToCsv } from '@paddlesnitch/timing/csv'

const TRACE = /^trials\/[^/]+\/entries\/[^/]+\/[^/]+\/trace\.([a-z0-9]+)$/

export async function run(apply: boolean): Promise<{ checked: number; changed: number; unreadable: number }> {
  const keys = (await listKeys('trials/')).filter(k => TRACE.test(k) && !k.endsWith('.json'))
  let checked = 0, changed = 0, unreadable = 0
  for (const key of keys) {
    const buf = await getObject(key)
    if (!buf) continue
    checked++
    const parsed = await parseTrace(key.split('/').pop()!, new Uint8Array(buf).buffer)
    if (!parsed.ok || parsed.track.length === 0) {
      unreadable++
      console.log(`${key}: can't parse (${parsed.ok ? 'empty' : parsed.reason}), left as is`)
      continue
    }
    const csv = trackToCsv(parsed.track)
    const target = key.replace(/trace\.[a-z0-9]+$/, 'trace.csv')
    if (target === key && buf.toString() === csv) continue   // already stripped
    changed++
    console.log(`${key} -> ${target} (${buf.length} -> ${csv.length} bytes)`)
    if (apply) {
      await putObject(target, csv)
      if (target !== key) await deleteObject(key)
    }
  }
  console.log(`strip-trial-traces: ${changed} of ${checked} trace(s) ${apply ? 'rewritten' : 'would change (dry run; add --apply)'}, ${unreadable} unreadable.`)
  return { checked, changed, unreadable }
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
