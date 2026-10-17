// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import AccountNav from '@paddlesnitch/ui/AccountNav'

// The DEVICES row appears when devicesHref is given — the dropdown is on
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
    accountHref="/account"
    signInHref="/signin"
    onSignOut={() => {}}
    {...extra}
  />
)

describe('AccountNav — Devices', () => {
  it('shows a Devices link when devicesHref is given', async () => {
    const menu = await openMenu(nav({ devicesHref: '/devices' }))
    const link = [...menu.querySelectorAll('a')].find(a => a.textContent === 'Devices')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('href')).toBe('/devices')
  })

  it('omits it when the host passes no devicesHref', async () => {
    const menu = await openMenu(nav())
    expect(menu.textContent).not.toContain('Devices')
    // the rest of the menu is unaffected
    expect(menu.textContent).toContain('Profile')
    expect(menu.textContent).toContain('Sign out')
  })

  it('lists Paddles, Devices, Profile, Account in that order, in sentence case', async () => {
    const menu = await openMenu(nav({ paddlesHref: '/paddles', devicesHref: '/devices' }))
    const labels = [...menu.querySelectorAll('a,button')].map(el => el.textContent)
    expect(labels).toEqual(['Paddles', 'Devices', 'Profile', 'Account', 'Report an issue', 'Sign out'])
  })
})

// On phones the account menu is the bottom bar's fourth tab, "You", and opens
// the same items as a bottom sheet.
describe('AccountNav — the phone "You" tab', () => {
  it('opens the same menu as a sheet', async () => {
    const menu = await openMenu(nav({ paddlesHref: '/paddles', devicesHref: '/devices', variant: 'tab' }))
    expect(container.querySelector('button[aria-haspopup="menu"]')?.textContent).toBe('You')
    expect(menu.className).toContain('bottom-0')
    const labels = [...menu.querySelectorAll('a,button')].map(el => el.textContent)
    expect(labels).toEqual(['Paddles', 'Devices', 'Profile', 'Account', 'Report an issue', 'Sign out'])
  })

  it('signed out, the tab is a Sign in link', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(nav({ user: null, variant: 'tab' })) })
    const link = container.querySelector('a')
    expect(link?.textContent).toBe('Sign in')
    expect(link?.getAttribute('href')).toBe('/signin')
  })
})
