#!/usr/bin/env node
// One-off (#915): give every portage flag written before the flagger's index
// existed its entry at users/{flagger}/portage-flags/{portageId}.json, so
// account erasure (which finds flags by that index, never by listing every
// portage) and the account export see it. A flag whose flagger's account no
// longer exists is an orphan erasure missed: it is deleted, and no index entry
// is written for it (that would bring back a users/ record for a deleted
// account). Idempotent. Prints counts only, never account ids or keys.
//
// Run once against production right after the #915 deploy, so flags from then
// on are indexed by the app itself. Dry run by default; add --apply to write.
//   DATA_BUCKET=paddlesnitch-data-prod AWS_PROFILE=paddlesnitch AWS_REGION=eu-west-1 \
//     COGNITO_USER_POOL_ID=<pool> npx tsx scripts/backfill-portage-flag-index.ts [--apply]

import { realpathSync } from 'fs'
import { fileURLToPath } from 'url'
import { listKeys, getJson, putJson, deleteObjects } from '../src/lib/storage'
import { accountExists } from '../src/lib/cognito'
import { flagIndexKey } from '@paddlesnitch/waterways/portage-store'

const FLAG = /^portages\/flags\/([^/]+)\/([^/]+)\.json$/

export async function backfillFlagIndex(
  apply: boolean,
  exists: (userId: string) => Promise<boolean> = accountExists,
): Promise<{ flags: number; indexed: number; orphans: number }> {
  const flags = (await listKeys('portages/flags/'))
    .map(key => ({ key, m: FLAG.exec(key) }))
    .filter((f): f is { key: string; m: RegExpExecArray } => !!f.m)
    .map(({ key, m }) => ({ key, portageId: m[1], flaggerId: m[2] }))
  // One lookup per flagger, not per flag. A lookup error stops the run.
  const alive = new Map<string, boolean>()
  for (const id of new Set(flags.map(f => f.flaggerId))) alive.set(id, await exists(id))

  const orphans = flags.filter(f => !alive.get(f.flaggerId)).map(f => f.key)
  let indexed = 0
  for (const f of flags.filter(f => alive.get(f.flaggerId))) {
    const index = flagIndexKey(f.flaggerId, f.portageId)
    if (await getJson(index)) continue
    indexed++
    if (apply) await putJson(index, (await getJson<{ at: string }>(f.key)) ?? { at: new Date().toISOString() })
  }
  if (apply) await deleteObjects(orphans)
  const done = apply ? `${indexed} indexed, ${orphans.length} orphan(s) deleted` : `${indexed} to index, ${orphans.length} orphan(s) to delete (dry run; add --apply)`
  console.log(`backfill-portage-flag-index: ${flags.length} flag(s); ${done}.`)
  return { flags: flags.length, indexed, orphans: orphans.length }
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
    // Storage and Cognito errors can quote a key, and keys hold account ids.
    console.error(`backfill-portage-flag-index failed: ${(err as Error)?.name ?? 'Error'}`)
    process.exit(1)
  })
}
