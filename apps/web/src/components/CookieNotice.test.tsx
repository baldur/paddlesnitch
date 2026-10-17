// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import CookieNotice from './CookieNotice'
import FeedbackWidget from '@paddlesnitch/ui/FeedbackWidget'

// Both are pinned to the bottom-right corner. The notice used to sit at the
// same offset as the floating REPORT AN ISSUE button, which (higher z) covered
// its OK button, so a visitor couldn't dismiss it. jsdom has no layout, so pin
// the classes that keep them apart.

let container: HTMLDivElement
let root: Root

// A fresh, empty store each test so the notice shows (it hides once acked).
beforeEach(() => {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } })
})
afterEach(async () => {
  vi.unstubAllGlobals()
  if (root) await act(async () => { root.unmount() })
  container?.remove()
})

async function mount(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(node) })
}

const zOf = (el: Element) => Number(/z-\[?(\d+)\]?/.exec(el.className)?.[1] ?? 0)

describe('cookie notice vs the floating report button', () => {
  it('sits above the Report button on desktop and the tab bar on phones', async () => {
    await mount(<><CookieNotice /><FeedbackWidget /></>)
    const notice = [...container.querySelectorAll('div')].find(d => d.textContent?.includes('We use cookies'))!
    const report = container.querySelector('button[aria-label="Report an issue"]')!
    expect(notice).toBeTruthy()
    expect(report.className).toContain('bottom-4')
    expect(report.className).toContain('sm:block') // the button only shows from sm up…
    // …so from sm up the notice is raised clear of it (2rem tall at bottom-4);
    // on phones it sits just above the bottom tab bar (3.5rem + safe area).
    expect(notice.className).toMatch(/(^|\s)sm:bottom-16(\s|$)/)
    expect(notice.className).toMatch(/(^|\s)bottom-\[calc\(4\.5rem\+env\(safe-area-inset-bottom,0px\)\)\](\s|$)/)
  })

  it('stays above Leaflet maps (panes go up to z-800)', async () => {
    await mount(<CookieNotice />)
    const notice = [...container.querySelectorAll('div')].find(d => d.textContent?.includes('We use cookies'))!
    expect(zOf(notice)).toBeGreaterThan(800)
  })
})

describe('cookie notice: shown until acknowledged', () => {
  const notice = () => [...container.querySelectorAll('div')].find(d => d.textContent?.includes('We use cookies'))

  it('stays hidden once the visitor has acknowledged it', async () => {
    localStorage.setItem('tt_cookie_acked', '1')
    await mount(<CookieNotice />)
    expect(notice()).toBeUndefined()
  })

  it('hides and remembers the acknowledgement when OK is pressed', async () => {
    await mount(<CookieNotice />)
    const ok = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === 'OK')!
    await act(async () => { ok.click() })
    expect(notice()).toBeUndefined()
    expect(localStorage.getItem('tt_cookie_acked')).toBe('1')
  })

  it('stays hidden when storage is blocked', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    await mount(<CookieNotice />)
    expect(notice()).toBeUndefined()
  })
})
