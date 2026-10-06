import { describe, it, expect, vi, beforeEach } from 'vitest'

const redirect = vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`) })
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }))
vi.mock('@/lib/auth', () => ({ getAuthUser: vi.fn() }))
vi.mock('@paddlesnitch/analysis/analysis-store', () => ({ listSessionSummaries: vi.fn() }))
vi.mock('./RecordingMotion', () => ({ default: () => null }))

import { getAuthUser } from '@/lib/auth'
import { listSessionSummaries } from '@paddlesnitch/analysis/analysis-store'
import RecordingPage from './page'

const go = (sessionId: string) => RecordingPage({ params: Promise.resolve({ deviceId: '435AC17C', sessionId }) })

beforeEach(() => {
  redirect.mockClear()
  vi.mocked(getAuthUser).mockResolvedValue({ id: 'u1', email: 'a@b.c', displayName: 'A' })
  vi.mocked(listSessionSummaries).mockResolvedValue([
    { id: 't-rec1', source: { type: 'device', deviceId: '435AC17C', deviceSessionId: 'rec1' } },
  ] as never)
})

describe('a recording page /devices/<tracker>/<recording>', () => {
  it("forwards a recording that became a paddle to the paddle's boat motion", async () => {
    await expect(go('rec1')).rejects.toThrow('REDIRECT /paddles/t-rec1/motion')
  })
  it('still shows a recording that is not a paddle (a test at home)', async () => {
    await expect(go('desk-test')).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
