// Bridge into the hardware-tracker uploads so a paddler can pick one of their own
// device sessions and analyse it here — the same way ATT trial entries are
// offered (see trials.ts). The device landed the raw CSV via the att upload
// endpoint (docs/features/device-uplink.md); we read it back through the shared
// storage and parse it on demand. Only the signed-in user's OWN sessions are
// listed or loaded (getDeviceSessionTrace checks ownership), so this exposes
// nothing another paddler couldn't already reach.
import { listUserDeviceSessions, getDeviceSessionTrace } from '@paddlesnitch/core/devices'
import { parseTrace } from '@paddlesnitch/timing/parse'
import type { TrackPoint } from '@paddlesnitch/timing/types'

export { listUserDeviceSessions } from '@paddlesnitch/core/devices'
export type { DeviceSessionMeta } from '@paddlesnitch/core/devices'

// The parsed track for one of the user's device sessions, or null if it isn't
// theirs / has no usable points. Reuses the SAME parser as every other source.
export async function loadDeviceSessionTrack(userId: string, deviceId: string, sessionId: string): Promise<TrackPoint[] | null> {
  const buf = await getDeviceSessionTrace(userId, deviceId, sessionId)
  if (!buf) return null
  // Copy into a fresh ArrayBuffer (Buffer.buffer may be a shared pool slab).
  const ab = new Uint8Array(buf).buffer
  const parsed = await parseTrace('trace.csv', ab)
  if (!parsed.ok || parsed.track.length < 2) return null
  return parsed.track
}
