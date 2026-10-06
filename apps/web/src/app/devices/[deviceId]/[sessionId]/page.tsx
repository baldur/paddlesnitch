import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/auth'
import { listSessionSummaries } from '@paddlesnitch/analysis/analysis-store'
import { paddleIdsByRecording } from '@paddlesnitch/analysis/tracker-paddle'
import RecordingMotion from './RecordingMotion'

// A recording's boat motion. A recording that became a paddle has its boat
// motion on the paddle now (one-paddle.md, phase 3), so it forwards there;
// a test at home that didn't become one still shows it here. Temporary, not
// permanent: a paddle can be deleted, and a cached 308 would keep sending
// people to it.
export default async function RecordingPage({ params }: { params: Promise<{ deviceId: string; sessionId: string }> }) {
  const { sessionId } = await params
  const user = await getAuthUser()
  const paddleId = user ? paddleIdsByRecording(await listSessionSummaries(user.id))[sessionId] : undefined
  if (paddleId) redirect(`/paddles/${paddleId}/motion`)
  return <RecordingMotion />
}
