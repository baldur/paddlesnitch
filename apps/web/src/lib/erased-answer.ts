import { NextResponse } from 'next/server'
import { erasureState } from '@paddlesnitch/core/erased'

/**
 * The phone calls' answer for an account being deleted, or null to carry on
 * (C3; mobile/contract/README.md § Phone recording). A deleted account's token
 * can live on for a day: 410 tells the app to delete that account's recordings.
 * While the delete is still running it's 503, so the app keeps its files: a
 * delete that fails leaves a live account (@paddlesnitch/core/erased).
 */
export async function erasedAnswer(userId: string): Promise<Response | null> {
  const state = await erasureState(userId)
  if (state === 'done') return NextResponse.json({ error: 'This account was deleted, so its recordings on this phone were removed.', accountDeleted: true }, { status: 410 })
  if (state === 'pending') return NextResponse.json({ error: "Couldn't upload right now. Please try again." }, { status: 503, headers: { 'Retry-After': '60' } })
  return null
}
