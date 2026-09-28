import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/auth'
import { listUserDeviceSessions } from '@paddlesnitch/core/devices'

// Old recording URL (/profile/me/devices/<sessionId>). The new one names the
// tracker too (/devices/<deviceId>/<sessionId>), which a static redirect rule
// can't supply, so look the recording up and forward. The proxy has already
// made the visitor sign in (/profile/me* is gated).
export default async function OldRecordingUrl({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const user = await getAuthUser()
  const mine = user ? (await listUserDeviceSessions(user.id)).find(s => s.sessionId === sessionId) : undefined
  redirect(mine ? `/devices/${mine.deviceId}/${sessionId}` : '/devices')
}
