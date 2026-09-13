#!/usr/bin/env node
// One-off data migration for phase 1 of groups-and-creation-gating: rename the
// `club` concept to `group` in STORED data so the renamed code (which now reads
// groups/*, users/*/groups.json, visibility 'group', visibleToGroupId) finds the
// existing records. Pure code rename is in the same PR; this moves the data.
//
// What it does (idempotent — safe to re-run; already-migrated keys are skipped):
//   1. clubs/{id}/...                → groups/{id}/...                 (copy + delete)
//      - invitation records also get  clubId → groupId
//   2. pending-invitations/clubs/... → pending-invitations/groups/... (+ clubId → groupId)
//   3. users/{id}/clubs.json         → users/{id}/groups.json         ({clubIds} → {groupIds})
//   4. course/trial metadata:          visibility 'club' → 'group', visibleToClubId → visibleToGroupId
//
// GroupMetadata itself kept the same fields as ClubMetadata, so club metadata.json
// bytes are copied unchanged.
//
// Run against PROD S3 (local dev uses wipe + `pnpm seed` instead):
//   DATA_BUCKET=paddlesnitch-data-prod AWS_PROFILE=paddlesnitch AWS_REGION=eu-west-1 \
//     npx tsx scripts/migrate-clubs-to-groups.ts
//
// Dry-run against your local .local-data:
//   USE_LOCAL_STORAGE=true npx tsx scripts/migrate-clubs-to-groups.ts

import { realpathSync } from 'fs'
import { fileURLToPath } from 'url'
import { getObject, putObject, deleteObject, listKeys, getJson, putJson } from '../src/lib/storage'

// ---------------- Pure transforms (unit-tested) ----------------

// users/{id}/clubs.json held { clubIds: string[] }; the renamed reverse index
// is { groupIds: string[] }. Accept either shape so a re-run is a no-op.
export function migrateUserGroupIndex(rec: Record<string, unknown> | null): { groupIds: string[] } {
  const ids =
    (rec?.clubIds as string[] | undefined) ??
    (rec?.groupIds as string[] | undefined) ??
    []
  return { groupIds: ids }
}

// ClubInvitation carried `clubId`; GroupInvitation carries `groupId`. Move the
// value across and drop the old key. Re-running is a no-op (groupId wins).
export function migrateInvitationRecord(inv: Record<string, unknown>): Record<string, unknown> {
  const { clubId, ...rest } = inv
  return { ...rest, groupId: rest.groupId ?? clubId }
}

// Course/trial metadata: visibility literal 'club' → 'group' and the field
// visibleToClubId → visibleToGroupId. Returns the (possibly) rewritten record
// plus whether anything actually changed, so we only re-write touched objects.
export function migrateVisibilityRecord(
  meta: Record<string, unknown>,
): { record: Record<string, unknown>; changed: boolean } {
  const out = { ...meta }
  let changed = false
  if (out.visibility === 'club') {
    out.visibility = 'group'
    changed = true
  }
  if ('visibleToClubId' in out) {
    out.visibleToGroupId = out.visibleToClubId
    delete out.visibleToClubId
    changed = true
  }
  return { record: out, changed }
}

// ---------------- Storage runners ----------------

// clubs/* → groups/*. Invitation JSON additionally gets clubId → groupId.
export async function migrateClubStorage(): Promise<number> {
  const keys = await listKeys('clubs/')
  let moved = 0
  for (const key of keys) {
    const newKey = 'groups/' + key.slice('clubs/'.length)
    const buf = await getObject(key)
    if (!buf) continue
    if (key.includes('/invitations/') && key.endsWith('.json')) {
      const inv = JSON.parse(buf.toString('utf8')) as Record<string, unknown>
      await putObject(newKey, JSON.stringify(migrateInvitationRecord(inv), null, 2))
    } else {
      await putObject(newKey, buf)
    }
    await deleteObject(key)
    moved++
  }
  return moved
}

// pending-invitations/clubs/* → pending-invitations/groups/* (+ clubId → groupId).
export async function migratePendingInvitations(): Promise<number> {
  const prefix = 'pending-invitations/clubs/'
  const keys = await listKeys(prefix)
  let moved = 0
  for (const key of keys) {
    const newKey = 'pending-invitations/groups/' + key.slice(prefix.length)
    const buf = await getObject(key)
    if (!buf) continue
    const inv = JSON.parse(buf.toString('utf8')) as Record<string, unknown>
    await putObject(newKey, JSON.stringify(migrateInvitationRecord(inv), null, 2))
    await deleteObject(key)
    moved++
  }
  return moved
}

// users/{id}/clubs.json → users/{id}/groups.json ({clubIds} → {groupIds}).
export async function migrateUserIndexes(): Promise<number> {
  const keys = (await listKeys('users/')).filter(k => k.endsWith('/clubs.json'))
  let moved = 0
  for (const key of keys) {
    const newKey = key.replace(/\/clubs\.json$/, '/groups.json')
    const rec = await getJson<Record<string, unknown>>(key)
    await putJson(newKey, migrateUserGroupIndex(rec))
    await deleteObject(key)
    moved++
  }
  return moved
}

// In-place visibility rewrite on every course + trial metadata.json.
export async function migrateVisibility(): Promise<number> {
  let touched = 0
  for (const prefix of ['courses/', 'trials/']) {
    const keys = (await listKeys(prefix)).filter(k => k.endsWith('/metadata.json'))
    for (const key of keys) {
      const meta = await getJson<Record<string, unknown>>(key)
      if (!meta) continue
      const { record, changed } = migrateVisibilityRecord(meta)
      if (changed) {
        await putJson(key, record)
        touched++
      }
    }
  }
  return touched
}

export async function run(): Promise<void> {
  const clubs = await migrateClubStorage()
  const pending = await migratePendingInvitations()
  const indexes = await migrateUserIndexes()
  const visibility = await migrateVisibility()
  console.log(
    `migrate-clubs-to-groups: moved ${clubs} club object(s), ${pending} pending invite(s), ` +
      `${indexes} user index file(s); rewrote visibility on ${visibility} course/trial(s).`,
  )
}

// Run only when invoked directly (`tsx scripts/...`), not when imported by tests.
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
