import { NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { revoke } from '@/lib/strava'
import { getStravaTokens, deleteStravaTokens, deleteAthleteIndex, getUserIdByAthleteId } from '@/lib/strava-storage'

export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tokens = await getStravaTokens(user.id)
  if (tokens) {
    // Revoke on Strava's side first; the user wants the relationship gone, and
    // a leftover access token outliving local storage is the worst case here.
    await revoke(tokens.accessToken)
    // Drop the reverse index too so a future Strava sign-in for this athlete
    // doesn't auto-land on an account the user explicitly unlinked.
    // Only when it points here: it may belong to another account by now.
    if (tokens.athleteId && (await getUserIdByAthleteId(tokens.athleteId)) === user.id) await deleteAthleteIndex(tokens.athleteId)
  }
  await deleteStravaTokens(user.id)
  return NextResponse.json({ ok: true })
}
