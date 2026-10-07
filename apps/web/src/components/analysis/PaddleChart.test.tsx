// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import PaddleChart, { bucket, smooth } from './PaddleChart'

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove() })

const points = Array.from({ length: 120 }, (_, i) => ({ t: i * 5, lat: 51, lng: -1, speed: i < 20 ? 0 : 3 + (i % 7) * 0.05, sr: i < 20 ? null : 56, dps: null }))
const surges = [{ kind: 'surge' as const, fromT: 300, toT: 360, durS: 60, distM: 200, avgSpeed: 3.4, splitPer500: 147, avgSR: 64 }]
const stops = [{ kind: 'stop' as const, fromT: 0, toT: 100, durS: 100, distM: 0, avgSpeed: 0, splitPer500: 0, avgSR: null }]

async function mount(onSeek = vi.fn(), cursor: number | null = null) {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<PaddleChart points={points} surges={surges as never} stops={stops as never} cursor={cursor} onSeek={onSeek} />) })
  return onSeek
}

describe('pace and stroke rate through the paddle', () => {
  it('draws pace and stroke rate, efforts and rests', async () => {
    await mount()
    const svg = container.querySelector('svg')!
    expect(svg.querySelectorAll('path').length).toBe(2)
    expect(svg.querySelectorAll('rect').length).toBe(2)
  })

  it('moves the replay to where you tap', async () => {
    const onSeek = await mount()
    const svg = container.querySelector('svg')!
    svg.getBoundingClientRect = () => ({ left: 0, width: 600, top: 0, height: 150, right: 600, bottom: 150, x: 0, y: 0, toJSON: () => ({}) })
    svg.setPointerCapture = () => {}
    await act(async () => { svg.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 600 - 4 })) })
    expect(onSeek).toHaveBeenLastCalledWith(119)
  })

  it('marks the replay position', async () => {
    await mount(vi.fn(), 60)
    expect(container.querySelectorAll('svg line').length).toBeGreaterThan(2)
  })

  it('smooths over neighbouring slices without filling a gap', () => {
    expect(smooth([1, null, 3, 5, 7])).toEqual([1, null, 4, 5, 6])
  })

  it('averages into slices of time, leaving a gap where there was nothing', () => {
    const pts = [0, 1, 2, 3].map(t => ({ t: t * 10, lat: 0, lng: 0, speed: t, sr: t >= 2 ? 50 + t : null, dps: null }))
    expect(bucket(pts, 2, p => p.sr)).toEqual([{ t: 7.5, v: null }, { t: 22.5, v: 52.5 }])
  })
})
