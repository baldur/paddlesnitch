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

  it('keeps the narrative + SEGMENTS in one bounded flex column so they cannot overlap', async () => {
    // Regression (not mobile-only): a long LLM narrative used to grow the
    // top-left HUD until it overlapped the bottom-left SEGMENTS panel. Both now
    // live as siblings in ONE bounded-height flex column, sharing the space; the
    // narrative is additionally height-capped + scrollable.
    await mount(<AnalysisView data={{ ...data, insight: 'x '.repeat(400).trim() }} />)
    const divs = Array.from(container.querySelectorAll('div'))
    const narrative = divs.find(el => el.className.includes('overflow-y-auto') && el.textContent?.includes('x x'))
    expect(narrative).toBeTruthy()
    expect(narrative!.className).toMatch(/max-h-\[\d+vh\]/)
    // the SAME flex column contains both the narrative and the SEGMENTS panel
    const column = divs.find(el =>
      el.className.includes('flex-col') && el.textContent?.includes('x x') && el.textContent?.includes('SEGMENTS'))
    expect(column).toBeTruthy()
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

describe('AnalysisView SHARE control (#206)', () => {
  const textBtn = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === label)

  it('shows a SHARE button when the paddle is saved (has a sessionId)', async () => {
    await mount(<AnalysisView data={data} sessionId="abc123" />)
    expect(textBtn('SHARE')).toBeTruthy()
  })

  it('keeps the top-right controls on screen on a phone: the button row wraps and the column is viewport-capped', async () => {
    // On a 426px phone the un-wrapped control row (NEW / MY PADDLES / SHARE /
    // DIARY / BOAT / ANALYSE A SECTION) overflowed off the left edge, hiding the
    // SHARE button. The row must wrap and the column must be width-capped.
    await mount(<AnalysisView data={data} sessionId="abc123" />)
    const share = textBtn('SHARE')!
    const row = share.parentElement!
    expect(row.className).toContain('flex-wrap')
    const column = row.parentElement!
    expect(column.className).toContain('max-w-[calc(100vw-1.5rem)]')
  })
})
