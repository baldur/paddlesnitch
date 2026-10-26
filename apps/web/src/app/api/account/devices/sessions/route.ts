import { NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { listUserDeviceSessions } from '@/lib/devices'
import { listSessionSummaries } from '@paddlesnitch/analysis/analysis-store'
import { paddleIdsByRecording } from '@paddlesnitch/analysis/tracker-paddle'

// GET /api/account/devices/sessions — AUTHENTICATED. Every session the signed-in
// user's trackers have uploaded (metadata only), newest first. `paddleId` on
// each that became a paddle (the website's paddles.byRecording, joined here so
// the apps need one call).
export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [sessions, paddles] = await Promise.all([listUserDeviceSessions(user.id), listSessionSummaries(user.id)])
  const paddleOf = paddleIdsByRecording(paddles)
  return NextResponse.json({
    sessions: sessions.map(s => (paddleOf[s.sessionId] ? { ...s, paddleId: paddleOf[s.sessionId] } : s)),
  })
}
