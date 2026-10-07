// @vitest-environment jsdom
// The floating REPORT AN ISSUE button sat on top of the full-screen paddle
// map's replay bar. The root layout turns it off there (and nowhere else).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const nav = vi.hoisted(() => ({ path: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }))

import FeedbackWidget from '@paddlesnitch/ui/FeedbackWidget'

import { FULL_SCREEN_MAPS } from '@/lib/full-screen-maps'

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove() })
async function at(path: string) {
  nav.path = path
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<FeedbackWidget noButtonOn={FULL_SCREEN_MAPS} />) })
  return !!container.querySelector('button[aria-label="Report an issue"]')
}

describe('where the floating report button shows', () => {
  it.each(['/paddles/t-rec1', '/paddles/shared/abc123'])('not on the full-screen map %s', async p => {
    expect(await at(p)).toBe(false)
  })
  it.each(['/', '/paddles', '/paddles/new', '/paddles/compare', '/paddles/t-rec1/motion', '/devices', '/att'])('on %s', async p => {
    expect(await at(p)).toBe(true)
  })
  it('still opens from the menu event on a map page', async () => {
    await at('/paddles/t-rec1')
    await act(async () => { window.dispatchEvent(new CustomEvent('paddlesnitch:open-feedback')) })
    expect(container.textContent).toContain('REPORT AN ISSUE')
  })
})
