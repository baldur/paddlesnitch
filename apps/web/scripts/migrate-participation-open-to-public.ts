#!/usr/bin/env node
// Phase 3 data migration: rename the legacy trial participation value
// 'open' → 'public'.
//
// Pre-phase-3, participation was 'open' | 'invitational', where 'open' meant
// "anyone who can view can submit". Phase 3 renames that to 'public' and adds
// 'members' (the new default for NEW trials). EXISTING trials keep their current
// open-to-anyone behaviour by becoming 'public' — we don't retroactively lock
// out participants of a running event.
//
// canSubmitToTrial already treats a stored 'open' as 'public' at read time, so
// this is data hygiene (and makes the stored value match the type); submission
// keeps working with or without it. Idempotent — skips anything not 'open'.
//
// Run against PROD S3 (local dev uses wipe + `pnpm seed`):
//   DATA_BUCKET=paddlesnitch-data-prod AWS_PROFILE=paddlesnitch AWS_REGION=eu-west-1 \
//     npx tsx scripts/migrate-participation-open-to-public.ts

import { realpathSync } from 'fs'
import { fileURLToPath } from 'url'
import { listKeys, getJson, putJson } from '../src/lib/storage'
import type { TrialMetadata } from '../src/lib/types'

// Pure helper (unit-tested): returns the rewritten record + whether it changed.
export function migrateParticipationRecord(
  trial: Record<string, unknown>,
): { record: Record<string, unknown>; changed: boolean } {
  if (trial.participation === 'open') {
    return { record: { ...trial, participation: 'public' }, changed: true }
  }
  return { record: trial, changed: false }
}

export async function run(): Promise<void> {
  const keys = (await listKeys('trials/')).filter(
    k => k.endsWith('metadata.json') && !k.includes('/entries/'),
  )
  let changed = 0
  for (const key of keys) {
    const trial = await getJson<TrialMetadata>(key)
    if (!trial) continue
    const { record, changed: didChange } = migrateParticipationRecord(trial as unknown as Record<string, unknown>)
    if (didChange) {
      await putJson(key, record)
      changed++
    }
  }
  console.log(`migrate-participation-open-to-public: rewrote ${changed} trial(s) from 'open' to 'public'.`)
}

const invokedDirectly = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  run().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
