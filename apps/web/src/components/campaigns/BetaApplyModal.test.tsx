// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))

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
