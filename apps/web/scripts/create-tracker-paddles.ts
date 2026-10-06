#!/usr/bin/env node
// Make a paddle for every tracker recording that hasn't one
// (docs/features/one-paddle.md, phase 2). New recordings get theirs as they
// arrive; this does the ones uploaded before that. Recordings with no usable
// GPS are skipped, and a recording that already has a paddle (added by hand)
// only gains stroke rate if its motion data allows. Each new paddle gets a
// written summary, so run it with the production AI settings (LLM_BACKEND,
// LLM_MODEL) or the summaries are the plain ones.
//
// Recordings where the boat moved less than MIN_PADDLE_METRES (desk tests) are
// skipped, as they are for new uploads. --skip=<file>,<file> leaves out others
// by filename (test copies of real paddles).
//
// Dry run by default -- prints what would change. Add --apply to write.
//   DATA_BUCKET=paddlesnitch-data-prod AWS_PROFILE=paddlesnitch AWS_REGION=eu-west-1 \
//     npx tsx scripts/create-tracker-paddles.ts [--apply] [--skip=track_x.csv,...]

import { realpathSync } from 'fs'
import { fileURLToPath } from 'url'
import { listKeys, getJson } from '../src/lib/storage'
import { planForRecording, paddleForRecording } from '@paddlesnitch/analysis/tracker-paddle'
import type { DeviceSessionMeta } from '@paddlesnitch/core/devices'

export async function run(apply: boolean, skip: string[] = []): Promise<Record<string, number>> {
  const keys = (await listKeys('devices/')).filter(k => /\/sessions\/[^/]+\/session\.json$/.test(k))
  const counts: Record<string, number> = {}
  for (const key of keys) {
    const m = await getJson<DeviceSessionMeta>(key)
    if (!m?.userId) continue
    if (skip.includes(m.filename)) { console.log(`${m.deviceId} ${m.filename}: skipped (--skip)`); continue }
    const plan = await planForRecording(m.userId, m.deviceId, m.sessionId)
    let what: string = plan.action
    if (apply && (plan.action === 'create' || plan.action === 'update')) {
      what = (await paddleForRecording(m.userId, m.deviceId, m.sessionId)).status
    }
    counts[what] = (counts[what] ?? 0) + 1
    if (plan.action === 'create' || plan.action === 'update') console.log(`${m.deviceId} ${m.filename}: ${what}${plan.action === 'create' && plan.hasStrokeRate ? ' (with stroke rate)' : ''}`)
  }
  console.log(`create-tracker-paddles: ${JSON.stringify(counts)}${apply ? '' : ' (dry run; add --apply)'}`)
  return counts
}

const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  const skip = process.argv.find(a => a.startsWith('--skip='))?.slice(7).split(',').filter(Boolean) ?? []
  run(process.argv.includes('--apply'), skip).catch(err => {
    console.error(err)
    process.exit(1)
  })
}
