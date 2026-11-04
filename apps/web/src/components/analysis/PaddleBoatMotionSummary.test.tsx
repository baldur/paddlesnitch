// @vitest-environment jsdom
// The paddle page shows a compact boat-motion readout — the balance (evenness)
// and side-to-side roll — for a tracker paddle that has usable attitude (#866),
// and nothing at all when the motion file hasn't arrived or carried none.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AttitudeReport } from '@paddlesnitch/timing/attitude'

import PaddleBoatMotionSummary from './PaddleBoatMotionSummary'

let container: HTMLDivElement
let root: Root
let fetchBody: unknown
let fetchOk = true
const calls: string[] = []

const attitude = (over: Partial<AttitudeReport> = {}): AttitudeReport => ({
  available: true, reason: '', sampleRateHz: 50, samples: 1000,
  envelope: [], excerpt: [], rollHistogram: null,
  rollRmsDeg: 4, pitchRmsDeg: 1.9, rollP5Deg: null, rollP95Deg: null,
  plotBoundDeg: null, rollToPitchRatio: 2.1, axisConfident: true,
  symmetry: { sideADeg: 5, sideBDeg: 4, imbalancePct: 13.5 },
  excludedWindows: 0, excludedSeconds: 0, ...over,
})

beforeEach(() => {
  calls.length = 0; fetchOk = true
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url)
    return Promise.resolve({ ok: fetchOk, json: () => Promise.resolve(fetchBody) })
  })
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
})

async function mount() {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<PaddleBoatMotionSummary sessionId="p1" deviceId="F00DCAFE" deviceSessionId="s9" />) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('boat-motion summary on the paddle page', () => {
  it('shows the balance and roll, and a link to the full boat-motion page', async () => {
    fetchBody = { attitude: attitude() }
    await mount()
    expect(calls[0]).toContain('/api/account/devices/sessions/s9?deviceId=F00DCAFE')
    expect(container.textContent).toContain('Evenness')
    expect(container.textContent).toContain('14%') // |13.5| rounded
    expect(container.textContent).toContain('4°')
    const link = container.querySelector('a[href="/paddles/p1/motion"]')
    expect(link).not.toBeNull()
  })

  it('renders nothing when the recording has no usable attitude', async () => {
    fetchBody = { attitude: attitude({ available: false, symmetry: null, rollRmsDeg: null }) }
    await mount()
    expect(container.textContent).toBe('')
  })

  it('renders nothing when the motion file has not arrived', async () => {
    fetchBody = { attitude: null }
    await mount()
    expect(container.textContent).toBe('')
  })

  it('stays silent on a failed read rather than showing an error', async () => {
    fetchOk = false; fetchBody = {}
    await mount()
    expect(container.textContent).toBe('')
  })
})
