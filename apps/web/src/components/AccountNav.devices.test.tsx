// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import AccountNav from '@paddlesnitch/ui/AccountNav'

// MY DEVICES is conditional on the viewer owning a tracker — the dropdown is on
// every page, and a permanent row would send the large majority of people to a
// page with nothing on it. The adapters decide; AccountNav just honours the prop.

let container: HTMLDivElement
let root: Root

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
})

const USER = { id: 'u1', email: 'a@b.c', displayName: 'Baldur' }

async function openMenu(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(node) })
  const trigger = container.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
  await act(async () => { trigger.click() })
  return container.querySelector('[role="menu"]') as HTMLElement
}

const nav = (extra: Record<string, unknown> = {}) => (
  <AccountNav
    user={USER}
    profileHref="/profile/me"
    accountHref="/profile/me/settings"
    signInHref="/att/auth"
    onSignOut={() => {}}
    {...extra}
  />
)

describe('AccountNav — MY DEVICES', () => {
  it('shows a MY DEVICES link when devicesHref is given', async () => {
    const menu = await openMenu(nav({ devicesHref: '/profile/me/devices' }))
    const link = [...menu.querySelectorAll('a')].find(a => a.textContent === 'MY DEVICES')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('href')).toBe('/profile/me/devices')
  })

  it('omits it entirely when the viewer has no tracker', async () => {
    const menu = await openMenu(nav())
    expect(menu.textContent).not.toContain('MY DEVICES')
    // the rest of the menu is unaffected
    expect(menu.textContent).toContain('MY PROFILE')
    expect(menu.textContent).toContain('SIGN OUT')
  })

  it('sits with MY PADDLES above the profile/settings rows', async () => {
    const menu = await openMenu(nav({ paddlesHref: '/paddles/library', devicesHref: '/profile/me/devices' }))
    const labels = [...menu.querySelectorAll('a,button')].map(el => el.textContent)
    expect(labels).toEqual(['MY PADDLES', 'MY DEVICES', 'MY PROFILE', 'SETTINGS', 'REPORT AN ISSUE', 'SIGN OUT'])
  })
})
