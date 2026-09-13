#!/usr/bin/env node
// Phase 2 data migration: give every existing course + trial an owning group.
//
// Pre-phase-2 data has no `groupId` — management was the creator (`adminUserId`).
// Phase 2 moves management to a group's admins, so each existing item needs a
// group. We mint one personal group per distinct owner ("{displayName}'s group",
// owner = that user) and stamp its id onto all of that owner's courses/trials.
// Legacy trials created on someone else's public course keep THEIR organiser as
// the group owner (assignment is by the item's own adminUserId).
//
// Idempotent: items that already have a groupId are skipped, so a re-run that
// finds nothing missing creates no groups.
//
// Run against PROD S3 (local dev uses wipe + `pnpm seed`, which seeds groups):
//   DATA_BUCKET=paddlesnitch-data-prod AWS_PROFILE=paddlesnitch AWS_REGION=eu-west-1 \
//   COGNITO_USER_POOL_ID=eu-west-1_BHyKJ0toh COGNITO_REGION=eu-west-1 \
//     npx tsx scripts/migrate-courses-trials-to-groups.ts

import { realpathSync } from 'fs'
import { fileURLToPath } from 'url'
import { listKeys, getJson, putJson } from '../src/lib/storage'
import { newGroup, putGroup, addUserToGroupIndex } from '../src/lib/groups'
import { findUserBySub } from '../src/lib/cognito'
import type { CourseMetadata, TrialMetadata } from '../src/lib/types'

// ---------------- Pure helper (unit-tested) ----------------

// The personal-group name for a migrated owner. Falls back to a generic label
// when Cognito has no display name for the sub.
export function personalGroupName(displayName: string | undefined | null): string {
  const name = (displayName ?? '').trim()
  return name ? `${name}'s group` : 'Personal group'
}

// ---------------- Runner ----------------

type Owned = { key: string; meta: CourseMetadata | TrialMetadata }
type NameLookup = (sub: string) => Promise<string | undefined>

const cognitoLookup: NameLookup = async sub => (await findUserBySub(sub))?.displayName

async function loadAll(prefix: string, isTrial: boolean): Promise<Owned[]> {
  const keys = (await listKeys(prefix)).filter(
    k => k.endsWith('metadata.json') && (!isTrial || !k.includes('/entries/')),
  )
  const out: Owned[] = []
  for (const key of keys) {
    const meta = await getJson<CourseMetadata | TrialMetadata>(key)
    if (meta) out.push({ key, meta })
  }
  return out
}

// `lookup` is injectable so tests can run without Cognito.
export async function run(lookup: NameLookup = cognitoLookup): Promise<void> {
  const items = [...(await loadAll('courses/', false)), ...(await loadAll('trials/', true))]

  // Owners with at least one item still lacking a groupId.
  const ownersNeeding = new Set<string>()
  for (const { meta } of items) {
    if (!meta.groupId && meta.adminUserId) ownersNeeding.add(meta.adminUserId)
  }

  // One personal group per such owner.
  const groupForOwner = new Map<string, string>()
  for (const ownerId of ownersNeeding) {
    const group = newGroup({ name: personalGroupName(await lookup(ownerId)), ownerId })
    await putGroup(group)
    await addUserToGroupIndex(ownerId, group.id)
    groupForOwner.set(ownerId, group.id)
  }

  // Stamp groupId onto each owner's items.
  let stamped = 0
  for (const { key, meta } of items) {
    const gid = groupForOwner.get(meta.adminUserId)
    if (!meta.groupId && gid) {
      await putJson(key, { ...meta, groupId: gid })
      stamped++
    }
  }

  console.log(
    `migrate-courses-trials-to-groups: created ${groupForOwner.size} personal group(s); ` +
      `stamped groupId on ${stamped} course/trial(s).`,
  )
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
