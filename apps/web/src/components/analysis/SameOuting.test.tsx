// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const cmp = vi.hoisted(() => ({ data: null as unknown }))
vi.mock('@/lib/trpc', () => ({ trpc: { paddles: { compareOuting: { useQuery: () => ({ data: cmp.data }) } } } }))

import SameOuting from './SameOuting'

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove() })

const pts = (lng: number) => [0, 1, 2].map(t => ({ t, lat: 51.46 + t * 0.0001, lng, speed: 2, sr: 56, dps: null }))
const A = { id: 't-rec1', source: { type: 'device' }, result: { points: pts(-0.93) } }
const B = { id: 'strava1', source: { type: 'strava' }, result: { points: pts(-0.9301) } }

async function mount() {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<SameOuting a={A} b={B} />) })
}

describe('comparing the same outing from two sources', () => {
  it('shows both tracks, how far apart they were, and stroke rate from each', async () => {
    cmp.data = { same: true, gap: { samples: 60, medianM: 6, worstM: 14, agreement: 1 }, strokeRate: [{ minute: 0, a: 56, b: 28 }, { minute: 1, a: 57, b: 29 }] }
    await mount()
    expect(container.textContent).toContain('SAME OUTING, TWO RECORDINGS')
    expect(container.textContent).toContain('TRACKER')
    expect(container.textContent).toContain('STRAVA')
    expect(container.textContent).toContain('6 m')
    expect(container.textContent).toContain('14 m')
    expect(container.querySelector('svg[aria-label="Both tracks"]')?.querySelectorAll('polyline').length).toBe(2)
    expect(container.querySelector('svg[aria-label="Stroke rate from each"]')).not.toBeNull()
  })

  it('shows nothing for two different outings (the normal comparison stands)', async () => {
    cmp.data = { same: false }
    await mount()
    expect(container.textContent).toBe('')
  })
})
