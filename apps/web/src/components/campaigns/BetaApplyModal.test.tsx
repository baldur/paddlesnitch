// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

vi.mock('@/lib/analytics', () => ({ capture: vi.fn() }))

import { capture } from '@/lib/analytics'
import BetaApplyModal from './BetaApplyModal'

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
  await act(async () => { root.render(<BetaApplyModal />) })
}
const dialog = () => document.querySelector('[role="dialog"]')
const openIt = () => act(async () => { (container.querySelector('button') as HTMLButtonElement).click() })

describe('beta tester application pop-up', () => {
  it('is closed until CLICK TO SNITCH is pressed, then shows the form', async () => {
    await mount()
    expect(dialog()).toBeNull()
    await openIt()
    expect(dialog()).not.toBeNull()
    expect(dialog()!.querySelector('form')).not.toBeNull()
  })

  it('counts the CLICK TO SNITCH press for the campaign dashboard', async () => {
    vi.mocked(capture).mockClear()
    await mount()
    expect(capture).not.toHaveBeenCalled()
    await openIt()
    expect(capture).toHaveBeenCalledWith('campaign_cta', { campaign: 'betatesters' })
  })

  it('shows no heading, but keeps a label for screen readers', async () => {
    await mount()
    await openIt()
    expect(dialog()!.querySelector('h1, h2, h3')).toBeNull()
    expect(dialog()!.textContent).not.toMatch(/apply to be a beta tester/i)
    expect(dialog()!.getAttribute('aria-label')).toBe('Apply to be a beta tester')
  })

  it('lays the form out in one column, top to bottom: name, email, sport, how often, then the button', async () => {
    await mount()
    await openIt()
    const form = dialog()!.querySelector('form')!
    expect(form.className).toContain('flex-col')
    expect(form.className).not.toMatch(/grid-cols|md:|sm:/)
    const order = [...form.querySelectorAll('input:not([name=website]), select, button[type=submit]')]
      .map(el => el.getAttribute('autocomplete') ?? el.tagName.toLowerCase())
    expect(order).toEqual(['name', 'email', 'select', 'select', 'button'])
    expect(form.querySelector('textarea, input[type=checkbox]')).toBeNull()
  })

  it('asks "How do you paddle?" with kayak, single scull, crew rowing, SUP, canoe in that order', async () => {
    await mount()
    await openIt()
    const form = dialog()!.querySelector('form')!
    expect(form.textContent).toContain('How do you paddle?')
    const options = [...form.querySelectorAll('select')[0].querySelectorAll('option:not([disabled])')].map(o => o.textContent)
    expect(options).toEqual(['Kayak', 'Single scull', 'Crew rowing', 'Paddleboard (SUP)', 'Canoe'])
  })

  it('closes on Escape and on a click on the dimmed background, but not on a click inside', async () => {
    await mount()
    await openIt()
    await act(async () => { (dialog() as HTMLElement).click() })
    expect(dialog()).not.toBeNull()
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(dialog()).toBeNull()

    await openIt()
    await act(async () => { (dialog()!.parentElement as HTMLElement).click() })
    expect(dialog()).toBeNull()
  })

  it('stops the page scrolling behind it while open', async () => {
    await mount()
    await openIt()
    expect(document.body.style.overflow).toBe('hidden')
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(document.body.style.overflow).toBe('')
  })
})
