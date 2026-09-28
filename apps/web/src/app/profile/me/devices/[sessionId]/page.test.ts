import { describe, it, expect, vi, beforeEach } from 'vitest'

const redirect = vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`) })
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }))
vi.mock('@/lib/auth', () => ({ getAuthUser: vi.fn() }))
vi.mock('@paddlesnitch/core/devices', () => ({ listUserDeviceSessions: vi.fn() }))

import { getAuthUser } from '@/lib/auth'
import { listUserDeviceSessions } from '@paddlesnitch/core/devices'
import OldRecordingUrl from './page'

const go = (sessionId: string) => OldRecordingUrl({ params: Promise.resolve({ sessionId }) })

beforeEach(() => {
  vi.mocked(getAuthUser).mockResolvedValue({ id: 'u1', email: 'a@b.c', displayName: 'A' })
  vi.mocked(listUserDeviceSessions).mockResolvedValue([{ sessionId: 's1', deviceId: '5A43CA48' } as never])
})

describe('old recording URL /profile/me/devices/<sessionId>', () => {
  it('forwards to the recording under its tracker', async () => {
    await expect(go('s1')).rejects.toThrow('REDIRECT /devices/5A43CA48/s1')
  })
  it('sends a recording that is not yours (or gone) to /devices, never to someone else\'s', async () => {
    await expect(go('someone-elses')).rejects.toThrow('REDIRECT /devices')
    expect(redirect).toHaveBeenLastCalledWith('/devices')
  })
})
