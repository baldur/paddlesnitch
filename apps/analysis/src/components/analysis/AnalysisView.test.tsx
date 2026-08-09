// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import AnalysisView, { type ViewData } from './AnalysisView'

// On a phone the floating panels obscure the map and the segment list is cut
// off behind the replay scrubber. The paddler can now minimise the summary and
// the segments panels to reveal the map. (#187)

// The Leaflet map + next router/link aren't relevant here — stub them so the
// panels render in jsdom.
vi.mock('@/components/map/AnalysisMapClient', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))

let container: HTMLDivElement
let root: Root

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.restoreAllMocks()
})

async function mount(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(node) })
}

const surge = {
  kind: 'surge' as const, fromT: 10, toT: 40, durS: 30, distM: 100,
  avgSpeed: 4, splitPer500: 125, avgSR: 70, srCv: 5, avgDps: 2.1, trend: 'up',
}

const data: ViewData = {
  durationS: 600, distanceKm: 3.2, avgSpeed: 3, avgSR: 60, avgDps: 2, cruiseSpeed: 3,
  strokeRateDoubled: false,
  points: [
    { t: 0, lat: 51, lng: -1, speed: 3, sr: 60, dps: 2 },
    { t: 1, lat: 51.001, lng: -1.001, speed: 3, sr: 60, dps: 2 },
  ],
  stops: [], surges: [surge], sets: [],
  insight: 'You held a strong steady rhythm throughout.',
}

const btn = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

describe('AnalysisView mobile panels (#187)', () => {
  it('minimises the summary HUD to hide the insight text and reveal the map', async () => {
    await mount(<AnalysisView data={data} />)
    expect(container.textContent).toContain('strong steady rhythm')

    await act(async () => { btn('Minimise summary')!.click() })
    expect(container.textContent).not.toContain('strong steady rhythm')
    // The at-a-glance stats stay visible when collapsed.
    expect(container.textContent).toContain('3.20 km')

    await act(async () => { btn('Expand summary')!.click() })
    expect(container.textContent).toContain('strong steady rhythm')
  })

  it('caps the narrative height + scrolls it so the HUD cannot grow into the segments panel', async () => {
    // Regression: a long LLM narrative used to push the top-left HUD down until
    // it overlapped the bottom-left SEGMENTS panel (worst on mobile). The
    // narrative now lives in a height-capped, scrollable container.
    await mount(<AnalysisView data={{ ...data, insight: 'x '.repeat(400).trim() }} />)
    const narrative = Array.from(container.querySelectorAll('div')).find(
      el => el.className.includes('overflow-y-auto') && el.textContent?.includes('x x'),
    )
    expect(narrative).toBeTruthy()
    expect(narrative!.className).toMatch(/max-h-\[\d+vh\]/)
  })

  it('minimises the segments panel to hide the efforts list', async () => {
    await mount(<AnalysisView data={data} />)
    expect(container.textContent).toContain('EFFORTS')

    await act(async () => { btn('Minimise segments')!.click() })
    expect(container.textContent).not.toContain('EFFORTS')
    // The panel header (with the expand control) is still there.
    expect(container.textContent).toContain('SEGMENTS')
    expect(btn('Expand segments')).not.toBeNull()
  })
})
