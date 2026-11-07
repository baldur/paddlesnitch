// @vitest-environment jsdom
// Boat motion and its technical details, drawn from the answers the apps
// decode too (mobile/contract/fixtures/api/account.devices-session*.json), so
// the website and the contract's README describe the same screen.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { readFileSync } from 'fs'
import path from 'path'
import { createRoot, type Root } from 'react-dom/client'
import BoatMotion, { CHART_MARGIN } from './BoatMotion'
import TechnicalDetails from './TechnicalDetails'
import { describeDeviceData } from '@paddlesnitch/timing/device'
import { trackCsv } from '@/tests/tracker-fixtures'

const fixture = (name: string) => JSON.parse(readFileSync(
  path.join(__dirname, '../../../../../mobile/contract/fixtures/api', `account.devices-session${name}.json`), 'utf8'))

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove() })
async function render(node: React.ReactNode) {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(node) })
  return container.textContent ?? ''
}

describe('boat motion', () => {
  it('draws the tiles from a measured recording, evenness by size', async () => {
    const r = fixture('')
    const text = await render(<BoatMotion attitude={r.attitude} strokeRate={60.1} />)
    expect(text).toContain(`${r.attitude.rollRmsDeg}°`)
    expect(text).toContain(`${Math.round(Math.abs(r.attitude.symmetry.imbalancePct))}%`)
    expect(text).toMatch(/Stroke rate60spm/)
  })

  it("keeps the engine's reason out of the paddler's box; it's under Technical details", async () => {
    const r = fixture('.motion-unusable')
    expect(r.attitude.available).toBe(false)
    const box = await render(<BoatMotion attitude={r.attitude} strokeRate={null} />)
    expect(box).toContain('No boat motion for this recording.')
    expect(box).toContain('We couldn’t measure boat motion in this recording.')
    expect(box).not.toContain(r.attitude.reason)
    await act(async () => { root.unmount() }); container.remove()
    const details = await render(<TechnicalDetails report={describeDeviceData(trackCsv(600, 9))} cadence={r.cadence} attitude={r.attitude} />)
    expect(details).toContain(`Boat motion: ${r.attitude.reason}`)
  })

  it("says the motion file hasn't arrived when there is none", async () => {
    const r = fixture('.no-motion')
    expect(await render(<BoatMotion attitude={r.attitude} strokeRate={null} />)).toContain('If this recording is recent, it may still be uploading.')
  })

  it("offers the tracker when the motion file hasn't arrived and the page knows which tracker", async () => {
    const r = fixture('.no-motion')
    await render(<BoatMotion attitude={r.attitude} strokeRate={null} deviceId="435AC17C" />)
    expect(container.querySelector('a[href="/devices/435AC17C"]')?.textContent).toBe('Open tracker')
  })

  it('offers no tracker when the motion arrived but could not be measured, or the tracker is unknown', async () => {
    await render(<BoatMotion attitude={fixture('.motion-unusable').attitude} strokeRate={null} deviceId="435AC17C" />)
    expect(container.querySelector('a')).toBeNull()
    await act(async () => { root.unmount() }); container.remove()
    await render(<BoatMotion attitude={fixture('.no-motion').attitude} strokeRate={null} />)
    expect(container.querySelector('a')).toBeNull()
  })
})

describe('boat motion charts', () => {
  // A 343 px phone leaves the chart about 300 px wide after the page gutters
  // and the panel's padding.
  const PHONE_CHART_PX = 300
  let rect: ReturnType<typeof vi.spyOn>
  afterEach(() => rect?.mockRestore())
  const atWidth = (px: number) => {
    rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: px, height: 0 } as DOMRect)
  }
  const svgs = () => [...container.querySelectorAll('svg')]
  const viewBoxWidth = (svg: SVGSVGElement) => Number(svg.getAttribute('viewBox')!.split(' ')[2])

  it('draws chart text at 11 px or more on a 343 px phone (it was about 4 px)', async () => {
    atWidth(PHONE_CHART_PX)
    await render(<BoatMotion attitude={fixture('').attitude} strokeRate={null} />)
    expect(svgs()).toHaveLength(3)
    for (const svg of svgs()) {
      const scale = PHONE_CHART_PX / viewBoxWidth(svg)
      const texts = [...svg.querySelectorAll('text')]
      expect(texts.length).toBeGreaterThan(0)
      for (const t of texts) {
        const size = Number(t.closest('[font-size]')!.getAttribute('font-size'))
        expect(size * scale, t.textContent!).toBeGreaterThanOrEqual(11)
      }
    }
  })

  it('reads seconds on the session chart for a recording under 30 s, not "0 min … 0 min"', async () => {
    const a = fixture('').attitude
    const short = { ...a, envelope: [{ ...a.envelope[0], t: 0 }, { ...a.envelope[1], t: 20_000 }] }
    await render(<BoatMotion attitude={short} strokeRate={null} />)
    const session = svgs()[0].textContent!
    expect(session).toContain('20 s')
    expect(session).not.toContain('min')
  })

  it('keeps the edge bars of the histogram inside the frame (they were half outside)', async () => {
    await render(<BoatMotion attitude={fixture('').attitude} strokeRate={null} />)
    const hist = svgs()[2]
    const W = viewBoxWidth(hist)
    const bars = [...hist.querySelectorAll('rect:not([data-legend])')]
    expect(bars.length).toBe(fixture('').attitude.rollHistogram.bins.length)
    for (const b of bars) {
      const x = Number(b.getAttribute('x')), w = Number(b.getAttribute('width'))
      expect(x).toBeGreaterThanOrEqual(CHART_MARGIN.L)
      expect(x + w).toBeLessThanOrEqual(W - CHART_MARGIN.R)
    }
  })

  it('keeps the edge bars inside the frame when the bins are not symmetric about 0', async () => {
    const a = fixture('').attitude
    const lopsided = { ...a, rollHistogram: { binWidthDeg: 5, bins: [-7.5, -2.5, 2.5].map(centreDeg => ({ centreDeg, count: 2 })) } }
    await render(<BoatMotion attitude={lopsided} strokeRate={null} />)
    const hist = svgs()[2]
    for (const b of hist.querySelectorAll('rect:not([data-legend])')) {
      expect(Number(b.getAttribute('x'))).toBeGreaterThanOrEqual(CHART_MARGIN.L)
      expect(Number(b.getAttribute('x')) + Number(b.getAttribute('width'))).toBeLessThanOrEqual(viewBoxWidth(hist) - CHART_MARGIN.R)
    }
  })

  it('draws legend swatches at 0.8 opacity or more, so the pitch swatch shows', async () => {
    await render(<BoatMotion attitude={fixture('').attitude} strokeRate={null} />)
    const swatches = [...container.querySelectorAll('svg rect[data-legend]')]
    expect(swatches.length).toBe(3)
    for (const s of swatches) {
      const fill = Number(s.getAttribute('fill-opacity') ?? 1) * Number(s.getAttribute('opacity') ?? 1)
      expect(fill).toBeGreaterThanOrEqual(0.8)
    }
  })

  // #855: roll and pitch told apart by colour alone. Each chart's legend names
  // them, each key is drawn as its series' line or edge is (stroke, width, dash,
  // opacity), the two differ by dash as well as colour, and everything plotted
  // stays under the legend band.
  const ys = (d: string) => d.split(/[MLZ\s]+/).filter(Boolean).map(Number).filter((_, i) => i % 2 === 1)
  const style = (el: Element) => ['stroke', 'stroke-width', 'stroke-dasharray', 'opacity'].map(a => el.getAttribute(a))
  function expectRollPitchLegend(svg: SVGSVGElement, keyTag: 'line' | 'rect') {
    const keys = [...svg.querySelectorAll(`${keyTag}[data-legend][data-series]`)]
    expect(keys.map(k => [k.getAttribute('data-series'), k.nextElementSibling?.textContent]))
      .toEqual([['roll', 'roll'], ['pitch', 'pitch']])
    for (const key of keys) {
      const series = key.getAttribute('data-series')!
      const drawn = [...svg.querySelectorAll(`path[data-series="${series}"][stroke]`)]
      expect(drawn).toHaveLength(1)
      expect(style(key), series).toEqual(style(drawn[0]))
      const bottom = keyTag === 'rect'
        ? Number(key.getAttribute('y')) + Number(key.getAttribute('height'))
        : Number(key.getAttribute('y1'))
      expect(bottom).toBeLessThanOrEqual(CHART_MARGIN.TL)
    }
    const [roll, pitch] = keys
    expect(roll.getAttribute('stroke-dasharray')).toBeNull()
    expect(pitch.getAttribute('stroke-dasharray')).toBe('4 3')
    const paths = [...svg.querySelectorAll('path[data-series]')]
    expect(paths.length).toBeGreaterThanOrEqual(2)
    for (const p of paths) for (const y of ys(p.getAttribute('d')!)) expect(y).toBeGreaterThanOrEqual(CHART_MARGIN.TL)
  }

  it('names roll and pitch on the Stroke shape chart, by dash as well as colour (#855: colour alone)', async () => {
    atWidth(PHONE_CHART_PX)
    await render(<BoatMotion attitude={fixture('').attitude} strokeRate={null} />)
    expectRollPitchLegend(svgs()[1], 'line')
  })

  it("edges the session chart's roll and pitch bands, pitch dashed, and keys them the same (#855: colour alone)", async () => {
    atWidth(PHONE_CHART_PX)
    await render(<BoatMotion attitude={fixture('').attitude} strokeRate={null} />)
    expectRollPitchLegend(svgs()[0], 'rect')
  })

  it('lines up the legend words on the session and Stroke shape charts (they sat 4 px apart)', async () => {
    await render(<BoatMotion attitude={fixture('').attitude} strokeRate={null} />)
    const words = (svg: SVGSVGElement) => [...svg.querySelectorAll('[data-legend] + text')].map(t => t.getAttribute('x'))
    expect(words(svgs()[1])).toHaveLength(2)
    expect(words(svgs()[1])).toEqual(words(svgs()[0]))
  })

  // #894: "roll" ended where pitch's line key began on Stroke shape, and "pitch"
  // stopped about 11 px short of the right edge. Android (#893) keeps 8 sp from
  // a word to the next key and right-aligns "pitch". Plex Mono is 0.6 em wide.
  it('keeps 8 px between "roll" and pitch\'s key and ends "pitch" at the right edge (they touched)', async () => {
    atWidth(PHONE_CHART_PX)
    await render(<BoatMotion attitude={fixture('').attitude} strokeRate={null} />)
    const ch = 11 * 0.6
    for (const svg of svgs().slice(0, 2)) {
      const W = viewBoxWidth(svg)
      const [rollWord, pitchWord] = [...svg.querySelectorAll('[data-legend] + text')]
      const pitchKey = svg.querySelector('[data-legend][data-series="pitch"]')!
      const keyX = Number(pitchKey.getAttribute('x') ?? pitchKey.getAttribute('x1'))
      const rollEnd = Number(rollWord.getAttribute('x')) + 'roll'.length * ch
      expect(keyX - rollEnd).toBeGreaterThanOrEqual(8 - 0.01)
      expect(pitchWord.getAttribute('text-anchor')).toBe('end')
      expect(Number(pitchWord.getAttribute('x'))).toBe(W - CHART_MARGIN.R)
    }
  })

  it('centres every legend key in the band above the plot, as Android does (it hugged the top)', async () => {
    atWidth(PHONE_CHART_PX)
    await render(<BoatMotion attitude={fixture('').attitude} strokeRate={null} />)
    const keys = [...container.querySelectorAll('svg [data-legend]')]
    expect(keys.length).toBe(5)
    for (const k of keys) {
      const mid = k.tagName === 'rect'
        ? Number(k.getAttribute('y')) + Number(k.getAttribute('height')) / 2
        : Number(k.getAttribute('y1'))
      expect(mid).toBe(CHART_MARGIN.TL / 2)
    }
  })

  it('keeps each legend in a band above the plot, clear of the tallest bars', async () => {
    atWidth(PHONE_CHART_PX)
    await render(<BoatMotion attitude={fixture('').attitude} strokeRate={null} />)
    for (const s of container.querySelectorAll('svg rect[data-legend]')) {
      expect(Number(s.getAttribute('y')) + Number(s.getAttribute('height'))).toBeLessThanOrEqual(CHART_MARGIN.TL)
    }
    for (const b of svgs()[2].querySelectorAll('rect:not([data-legend])')) {
      expect(Number(b.getAttribute('y'))).toBeGreaterThanOrEqual(CHART_MARGIN.TL)
    }
  })

  it('redraws at the new width when the chart is resized (a phone turned sideways)', async () => {
    const observers: { cb: () => void; disconnect: ReturnType<typeof vi.fn> }[] = []
    vi.stubGlobal('ResizeObserver', class {
      cb: () => void; disconnect = vi.fn()
      constructor(cb: () => void) { this.cb = cb; observers.push(this) }
      observe() {}
    })
    try {
      atWidth(PHONE_CHART_PX)
      await render(<BoatMotion attitude={fixture('').attitude} strokeRate={null} />)
      expect(svgs().map(viewBoxWidth)).toEqual([300, 300, 300])
      rect.mockReturnValue({ width: 640, height: 0 } as DOMRect)
      await act(async () => { observers.forEach(o => o.cb()) })
      expect(svgs().map(viewBoxWidth)).toEqual([640, 640, 640])
      await act(async () => { root.unmount() })
      expect(observers.length).toBe(3)
      for (const o of observers) expect(o.disconnect).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('notes clipped moments under the chart, not on it, and only when there are some', async () => {
    const a = fixture('').attitude
    const wild = { ...a, envelope: a.envelope.map((b: { rollMax: number }, i: number) => (i === 5 ? { ...b, rollMax: a.plotBoundDeg + 4 } : b)) }
    await render(<BoatMotion attitude={wild} strokeRate={null} />)
    const note = [...container.querySelectorAll('p')].find(p => p.textContent!.startsWith('A few moments went past'))
    expect(note?.textContent).toBe(`A few moments went past ±${a.plotBoundDeg.toFixed(0)}° and are clipped at the chart’s edge.`)
    expect(note!.closest('svg')).toBeNull()
    await act(async () => { root.unmount() }); container.remove()
    const calm = { ...a, plotBoundDeg: 90 }
    expect(await render(<BoatMotion attitude={calm} strokeRate={null} />)).not.toContain('A few moments went past')
  })
})

describe('the way to the tracker', () => {
  it('names a phone a phone', async () => {
    await render(<BoatMotion attitude={fixture('.no-motion').attitude} strokeRate={null} deviceId="P0123456789ABCDEF" />)
    expect(container.querySelector('a[href="/devices/P0123456789ABCDEF"]')?.textContent).toBe('Open phone')
  })
})
