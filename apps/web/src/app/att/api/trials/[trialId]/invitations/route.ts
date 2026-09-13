import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getJson, putJson } from '@/lib/storage'
import { canManageTrial } from '@/lib/permissions'
import { getUserAdminGroupIds } from '@/lib/groups'
import { findUserByEmail, findUserBySub } from '@/lib/cognito'
import type { TrialMetadata } from '@/lib/types'

type Params = { params: Promise<{ trialId: string }> }

// GET /att/api/trials/[trialId]/invitations
// Returns the resolved invitee list ({ userId, email, displayName }[]) so
// the admin UI can render names instead of opaque Cognito subs. Owner-only.
export async function GET(_: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { trialId } = await params
  const trial = await getJson<TrialMetadata>(`trials/${trialId}/metadata.json`)
  if (!trial) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canManageTrial(trial, user, await getUserAdminGroupIds(user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Resolve each sub through Cognito. Failures degrade to the sub itself
  // as displayName so the row still renders.
  const resolved = await Promise.all(
    (trial.invitedUserIds ?? []).map(async sub => {
      const u = await findUserBySub(sub)
      return u ?? { sub, email: '', displayName: sub }
    })
  )
  return NextResponse.json({ invitees: resolved })
}

// POST /att/api/trials/[trialId]/invitations  { email }
// Resolves the email to an existing Cognito user, adds their sub to the
// trial's invitedUserIds. 422 if the email doesn't match an account
// (pre-signup pending invitations land with phase 4).
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { trialId } = await params
  const trial = await getJson<TrialMetadata>(`trials/${trialId}/metadata.json`)
  if (!trial) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canManageTrial(trial, user, await getUserAdminGroupIds(user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const invitee = await findUserByEmail(email)
  if (!invitee) {
    // We deliberately distinguish "no such user" from other failures so the
    // UI can prompt the inviter to double-check the address. Pre-signup
    // invitations (queue the email, merge in on signup) are phase 4 scope.
    return NextResponse.json({ error: 'No account found for that email' }, { status: 422 })
  }

  // Idempotent: re-inviting an already-invited sub is a no-op.
  const current = trial.invitedUserIds ?? []
  if (!current.includes(invitee.sub)) {
    const updated: TrialMetadata = { ...trial, invitedUserIds: [...current, invitee.sub] }
    await putJson(`trials/${trialId}/metadata.json`, updated)
  }
  return NextResponse.json({ invitee }, { status: 201 })
}
