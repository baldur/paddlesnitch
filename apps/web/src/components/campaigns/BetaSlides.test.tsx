// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

import BetaSlides from './BetaSlides'

const SLIDES = [
  { title: 'First', body: 'one' },
  { title: 'Second', body: 'two' },
  { title: 'Third', body: 'three' },
]

let container: HTMLDivElement
let root: Root
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
})

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<BetaSlides slides={SLIDES} />) })
}
const visible = () => [...container.querySelectorAll('article')].filter(a => !a.hidden).map(a => a.querySelector('h1,h2')!.textContent)
const btn = (label: string) => container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
const snitch = () => [...container.querySelectorAll('button')].find(b => b.textContent === 'CLICK TO SNITCH')!
const click = (b: HTMLElement) => act(async () => { b.click() })
const key = (k: string) => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })) })

describe('beta testers carousel', () => {
  it('starts on the first card with Previous disabled', async () => {
    await mount()
    expect(visible()).toEqual(['First'])
    expect(btn('Previous').disabled).toBe(true)
  })

  it('flips forward and back with the side arrows, one card at a time', async () => {
    await mount()
    await click(btn('Next'))
    expect(visible()).toEqual(['Second'])
    await click(btn('Next'))
    expect(visible()).toEqual(['Third'])
    expect(btn('Next').disabled).toBe(true)
    await click(btn('Previous'))
    expect(visible()).toEqual(['Second'])
  })

  it('flips with the keyboard arrows and jumps with the dots', async () => {
    await mount()
    await key('ArrowRight')
    expect(visible()).toEqual(['Second'])
    await key('ArrowLeft')
    expect(visible()).toEqual(['First'])
    await click(btn('Show 3 of 3'))
    expect(visible()).toEqual(['Third'])
  })

  it('flips on a swipe', async () => {
    await mount()
    const deck = container.querySelector('[aria-roledescription="carousel"]')!
    const touch = (type: string, x: number, y = 0) => {
      const e = new Event(type, { bubbles: true }) as Event & Record<string, unknown>
      e[type === 'touchstart' ? 'touches' : 'changedTouches'] = [{ clientX: x, clientY: y }]
      deck.dispatchEvent(e)
    }
    await act(async () => { touch('touchstart', 300); touch('touchend', 100) })
    expect(visible()).toEqual(['Second'])
    await act(async () => { touch('touchstart', 100); touch('touchend', 300) })
    expect(visible()).toEqual(['First'])
    // A page scroll that drifts sideways (mostly vertical) must not flip.
    await act(async () => { touch('touchstart', 200, 500); touch('touchend', 140, 200) })
    expect(visible()).toEqual(['First'])
  })

  it('makes CLICK TO SNITCH bounce only on the last card, and not for reduced motion', async () => {
    await mount()
    expect(snitch().className).not.toContain('animate-bounce')
    await click(btn('Show 3 of 3'))
    expect(snitch().className).toContain('motion-safe:animate-bounce')
    await click(btn('Previous'))
    expect(snitch().className).not.toContain('animate-bounce')
  })

  it('shows a down arrow at the bottom of the last card only, pointing at the button', async () => {
    await mount()
    const arrow = () => [...container.querySelectorAll('[data-testid="down-arrow"]')].filter(el => !el.closest('article')!.hidden)
    expect(arrow()).toHaveLength(0)
    await click(btn('Show 3 of 3'))
    expect(arrow()).toHaveLength(1)
    expect(arrow()[0].textContent).toBe('↓')
  })

  it('leaves the arrow keys alone while the form pop-up is open', async () => {
    await mount()
    await click(snitch())
    await key('ArrowRight')
    expect(visible()).toEqual(['First'])
  })
})
