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
    const text = await mount(new Response(JSON.stringify({ error: 'oops' }), { status: 500 }))
    expect(text).toContain('Couldn’t read this recording.')
    expect(text).not.toContain('it may still be uploading')
  })

  it("says a recording that's gone (404) can't be found, with no Try again that would fail every time", async () => {
    const text = await mount(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }))
    expect(text).toContain("We can't find this recording")
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Try again')).toBe(false)
  })

  it('shows the error again, and puts focus on it, when Try again fails too', async () => {
    const list = () => new Response(JSON.stringify({ sessions: [{ sessionId: 'rec1', deviceId: 'C0FFEE01', filename: 'track_1.csv', uploadedAt: '2026-10-25T08:00:00Z' }] }))
    const fetchMock = vi.fn(async (url: string) => url === '/api/account/devices/sessions' ? list() : new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<RecordingMotion />) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const retry = [...container.querySelectorAll('button')].find(b => b.textContent === 'Try again')!
    await act(async () => { retry.click() })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const alert = container.querySelector('[role="alert"]')!
    expect(alert.textContent).toBe('Couldn’t read this recording.')
    expect(document.activeElement).toBe(alert.parentElement)
  })

  it('offers Try again after a failed read, and reads it again', async () => {
    await mount(new Response(JSON.stringify({ error: 'oops' }), { status: 500 }))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Couldn’t read this recording.')
    const retry = [...container.querySelectorAll('button')].find(b => b.textContent === 'Try again')!
    expect(retry).toBeDefined()
    const fetchMock = vi.fn(async (url: string) => url === '/api/account/devices/sessions'
      ? new Response(JSON.stringify({ sessions: [{ sessionId: 'rec1', deviceId: 'C0FFEE01', filename: 'track_1.csv', uploadedAt: '2026-10-25T08:00:00Z' }] }))
      : new Response(JSON.stringify({ report: describeDeviceData(trackCsv(600, 9)), cadence: null, attitude: null })))
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { retry.click() })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(fetchMock).toHaveBeenCalledWith('/api/account/devices/sessions/rec1?deviceId=C0FFEE01')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    // The motion file hasn't arrived: the box links to the tracker.
    expect(container.textContent).toContain('it may still be uploading')
    expect(container.querySelector('a[href="/devices/C0FFEE01"]')?.textContent).toBe('Open tracker')
  })
})
