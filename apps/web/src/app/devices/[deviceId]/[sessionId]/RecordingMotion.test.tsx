// @vitest-environment jsdom
// A tracker recording that didn't become a paddle: its boat motion, and why
// there is none, under Technical details (the paddler's box says it plainly).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describeDeviceData } from '@paddlesnitch/timing/device'
import { trackCsv } from '@/tests/tracker-fixtures'

vi.mock('next/navigation', () => ({ useParams: () => ({ deviceId: 'c0ffee01', sessionId: 'rec1' }) }))
vi.mock('@/components/AppHeader', () => ({ default: () => <header /> }))

import RecordingMotion from './RecordingMotion'

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove(); vi.unstubAllGlobals() })

async function mount(answer: Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/account/devices/sessions'
    ? new Response(JSON.stringify({ sessions: [{ sessionId: 'rec1', deviceId: 'C0FFEE01', filename: 'track_1.csv', uploadedAt: '2026-10-25T08:00:00Z' }] }))
    : answer))
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<RecordingMotion />) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  return container.textContent ?? ''
}

const unusable = { available: false, reason: 'Motion file has too few samples to describe attitude.' }

describe("a tracker recording's boat motion", () => {
  it('says plainly there is none, with the reason under Technical details', async () => {
    const text = await mount(new Response(JSON.stringify({
      report: describeDeviceData(trackCsv(600, 9)), cadence: null, attitude: { ...unusable, envelope: [], excerpt: [] },
    })))
    expect(text).toContain('No boat motion for this recording.')
    expect(text).toContain('Technical details')
    expect(text).toContain(`Boat motion: ${unusable.reason}`)
  })

  it("shows a failed read as an error, not as motion that hasn't arrived", async () => {
    const text = await mount(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }))
    expect(text).toContain('Couldn’t read this recording. Please try again.')
    expect(text).not.toContain('sync the tracker again')
  })
})
