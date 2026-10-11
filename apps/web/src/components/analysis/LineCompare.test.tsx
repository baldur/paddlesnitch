// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { AnalysisPoint } from '@paddlesnitch/analysis/analysis'

// The map is Leaflet; here it records what it was given and lets the test tap.
const map = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
vi.mock('@/components/map/CompareMapClient', () => ({ default: (p: Record<string, unknown>) => { map.props = p; return <div>MAP</div> } }))

import LineCompare from './LineCompare'

const LAT0 = 51.46, LNG0 = -0.93
const pt = (t: number, x: number, y: number): AnalysisPoint => ({ t, lat: LAT0 + y / 110_540, lng: LNG0 + x / 69_400, speed: 3, sr: null, dps: null })
// 1.2 km north at `v` m/s.
const north = (v: number, from = 0, to = 1200) => Array.from({ length: Math.floor((to - from) / v) + 1 }, (_, k) => pt(k, 0, from + k * v))

let container: HTMLDivElement, root: Root
afterEach(async () => { await act(async () => root.unmount()); container.remove(); map.props = null })
async function mount(a: AnalysisPoint[], b: AnalysisPoint[]) {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  await act(async () => root.render(<LineCompare a={{ label: '12 Jul', points: a }} b={{ label: '15 Jul', points: b }} />))
}
const tap = async (x: number, y: number) => {
  const onPick = map.props!.onPick as (ll: [number, number]) => void
  await act(async () => onPick([LAT0 + y / 110_540, LNG0 + x / 69_400]))
}

describe('two paddles on one map', () => {
  it('compares the whole paddles when they went the same way, and says who was faster', async () => {
    await mount(north(3), north(3.3))
    expect(container.textContent).toMatch(/15 Jul was \d+ s faster/)
    expect(container.textContent).toContain('WHOLE PADDLES')
    expect(container.textContent).toContain('REPLAY')
    expect((map.props!.a as unknown[]).length).toBeGreaterThan(100)
  })

  it('in a different order: compares the longest stretch both paddled the same way, and a picked one', async () => {
    // B: the top half first, then back down, then the bottom half.
    const top = north(3, 600, 1200)
    const down = Array.from({ length: 300 }, (_, k) => pt(top.length + k, 0, 1200 - k * 4))
    const bottom = north(3.5, 0, 600).map(p => ({ ...p, t: p.t + top.length + 300 }))
    await mount(north(3), [...top, ...down, ...bottom])
    expect(container.textContent).toContain('THE LONGEST STRETCH YOU BOTH PADDLED THE SAME WAY (0.6 KM)')
    await tap(0, 100)
    expect(container.textContent).toContain('Now tap where the stretch ends.')
    await tap(0, 500)
    expect(container.textContent).toContain('THE STRETCH YOU PICKED')
    expect(container.textContent).toMatch(/15 Jul was \d+ s faster/)      // 3.5 vs 3 m/s on that stretch
    expect((map.props!.gates as unknown[]).length).toBe(2)
    const whole = [...container.querySelectorAll('button')].find(b => b.textContent === 'WHOLE PADDLES')!
    await act(async () => whole.click())
    expect(container.textContent).toContain('THE LONGEST STRETCH')
  })

  it('on different water: says so and asks for a stretch', async () => {
    await mount(north(3), north(3).map(p => ({ ...p, lng: p.lng + 0.05 })))
    expect(container.textContent).toContain("didn't paddle the same water in the same direction")
  })

  it("ignores a tap away from the blue line", async () => {
    await mount(north(3), north(3.3))
    await tap(400, 500)
    expect(container.textContent).not.toContain('Now tap where the stretch ends.')
  })
})
