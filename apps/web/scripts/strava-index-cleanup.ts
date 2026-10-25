#!/usr/bin/env node
// Remove Strava athlete links left by accounts that no longer exist.
//
// `strava-athletes/{athleteId}.json` says which account a Strava athlete
// belongs to. Since 2026-10-25 a Strava account linked to one paddlesnitch
// account is never moved to another (security review, C5), so a link left by a
// deleted account would block that athlete for good. Erasure, disconnect and
// connecting a different athlete now clean up after themselves; this removes
// links left from before. A link is removed ONLY when Cognito says the account
// does not exist. Any error stops the run, because "couldn't check" must never
// count as "gone".
//
// Dry run by default -- prints what would go. Add --apply to delete.
//   DATA_BUCKET=paddlesnitch-data-prod AWS_PROFILE=paddlesnitch AWS_REGION=eu-west-1 \
//   COGNITO_USER_POOL_ID=eu-west-1_BHyKJ0toh COGNITO_REGION=eu-west-1 \
//     npx tsx scripts/strava-index-cleanup.ts [--apply]

import { realpathSync } from 'fs'
import { fileURLToPath } from 'url'
import { listKeys, getJson, deleteObject } from '../src/lib/storage'
import { userExistsBySub } from '@paddlesnitch/core/cognito'

export async function run(apply: boolean, exists: (sub: string) => Promise<boolean> = userExistsBySub): Promise<{ checked: number; stale: string[] }> {
  const keys = (await listKeys('strava-athletes/')).filter(k => /^strava-athletes\/\d+\.json$/.test(k))
  const stale: string[] = []
  for (const key of keys) {
    const rec = await getJson<{ userId?: string }>(key)
    if (!rec?.userId) continue
    // Throws on any Cognito error, which ends the run before anything else is deleted.
    if (await exists(rec.userId)) continue
    stale.push(key)
    console.log(`${key}: account ${rec.userId} no longer exists`)
    if (apply) await deleteObject(key)
  }
  console.log(`strava-index-cleanup: ${stale.length} of ${keys.length} link(s) ${apply ? 'removed' : 'would be removed (dry run; add --apply)'}.`)
  return { checked: keys.length, stale }
}

const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch { return false }
})()
if (invokedDirectly) {
  run(process.argv.includes('--apply')).catch(err => { console.error(err); process.exit(1) })
}
