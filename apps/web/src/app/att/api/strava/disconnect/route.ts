import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { revoke } from '@/lib/strava'
import { getStravaTokens, deleteStravaTokens, deleteAthleteIndex } from '@/lib/strava-storage'

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tokens = await getStravaTokens(user.id)
  if (tokens) {
    // Revoke on Strava's side first; the user wants the relationship gone, and
    // a leftover access token outliving local storage is the worst case here.
    await revoke(tokens.accessToken)
    // Drop the reverse index too so a future Strava sign-in for this athlete
    // doesn't auto-land on an account the user explicitly unlinked.
    if (tokens.athleteId) await deleteAthleteIndex(tokens.athleteId)
  }
  await deleteStravaTokens(user.id)
  return NextResponse.json({ ok: true })
}
