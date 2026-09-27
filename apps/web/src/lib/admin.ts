// Platform administrator — a HUMAN operator of paddlesnitch itself.
//
// This is a new and deliberately minimal concept. It is NOT the same thing as a
// group owner/admin (`src/lib/permissions.ts`), which is about one club's
// courses and trials and is stored per group. This is "may look at operational
// data across accounts", and right now it has exactly one user: me.
//
// The allowlist is an env var of Cognito `sub`s rather than a flag in storage,
// on purpose: there is no route that can grant it, so privilege escalation needs
// a deploy. When there is a second administrator and someone needs to add a
// third without one, that is the moment to move it into storage — not before.
//
// Empty/unset means NOBODY is an admin. A missing config must not open a door.
import type { AuthUser } from '@paddlesnitch/core/types'

export function adminUserIds(): Set<string> {
  return new Set(
    (process.env.ADMIN_USER_IDS ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  )
}

export function isPlatformAdmin(user: Pick<AuthUser, 'id'> | null | undefined): boolean {
  if (!user?.id) return false
  return adminUserIds().has(user.id)
}
