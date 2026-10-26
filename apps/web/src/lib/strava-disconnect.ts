import { revoke } from '@/lib/strava'
import { getStravaTokens, deleteStravaTokens, deleteAthleteIndex, getUserIdByAthleteId } from '@/lib/strava-storage'

// Ends an account's Strava connection: revoked on Strava's side first (a
// leftover access token outliving local storage is the worst case), the
// athlete index dropped so a later Strava sign-in doesn't land here (only when
// it points here: it may belong to another account by now), then the tokens.
export async function disconnectStrava(userId: string): Promise<boolean> {
  const tokens = await getStravaTokens(userId)
  if (tokens) {
    await revoke(tokens.accessToken)
    if (tokens.athleteId && (await getUserIdByAthleteId(tokens.athleteId)) === userId) await deleteAthleteIndex(tokens.athleteId)
  }
  await deleteStravaTokens(userId)
  return !!tokens
}
