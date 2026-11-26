#!/usr/bin/env node
// One-off (#915): give every portage flag written before the flagger's index
// existed its entry at users/{flagger}/portage-flags/{portageId}.json, so
// account erasure (which finds flags by that index, never by listing every
// portage) and the account export see it. Idempotent: an entry already there
// is left alone. Prints counts only, never account ids.
//
// Dry run by default. Add --apply to write.
//   DATA_BUCKET=paddlesnitch-data-prod AWS_PROFILE=paddlesnitch AWS_REGION=eu-west-1 \
//     npx tsx scripts/backfill-portage-flag-index.ts [--apply]

import { realpathSync } from 'fs'
import { fileURLToPath } from 'url'
import { listKeys, getJson, putJson } from '../src/lib/storage'
import { flagIndexKey } from '@paddlesnitch/waterways/portage-store'

const FLAG = /^portages\/flags\/([^/]+)\/([^/]+)\.json$/

export async function backfillFlagIndex(apply: boolean): Promise<{ flags: number; missing: number }> {
  let flags = 0
  let missing = 0
  for (const key of await listKeys('portages/flags/')) {
    const m = FLAG.exec(key)
    if (!m) continue
    flags++
    const [, portageId, flaggerId] = m
    const index = flagIndexKey(flaggerId, portageId)
    if (await getJson(index)) continue
    missing++
    if (apply) await putJson(index, (await getJson<{ at: string }>(key)) ?? { at: new Date().toISOString() })
  }
  console.log(`backfill-portage-flag-index: ${missing} of ${flags} flag(s) ${apply ? 'indexed' : 'unindexed (dry run; add --apply)'}.`)
  return { flags, missing }
}

const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  backfillFlagIndex(process.argv.includes('--apply')).catch(err => {
    console.error(err)
    process.exit(1)
  })
}
