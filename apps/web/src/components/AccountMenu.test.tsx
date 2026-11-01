// @vitest-environment jsdom
// The account menu shows the user the page came with, on first paint and with
// no extra request (#411); it asks only when the server couldn't tell.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

vi.mock('next/navigation', () => ({ usePathname: () => '/paddles' }))
import AccountMenu from './AccountMenu'
import { SessionUserProvider } from './SessionUser'

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove(); vi.unstubAllGlobals() })

const calls = () => vi.mocked(fetch).mock.calls.map(c => String(c[0]))
async function mount(user: { id: string; displayName: string; placeholderEmail?: true } | null | undefined, both = false, meEmail = 'asked@example.com') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes('/auth/me') ? { id: 'u9', displayName: 'Asked', email: meEmail } : { result: { data: 0 } },
  ))))
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  const menus = both ? <><AccountMenu /><AccountMenu variant="tab" /></> : <AccountMenu />
  await act(async () => { root.render(<SessionUserProvider user={user}>{menus}</SessionUserProvider>) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

describe('the account menu', () => {
  it('is in the first HTML for a signed-in page (no empty slot)', () => {
    const html = renderToString(<SessionUserProvider user={{ id: 'u1', displayName: 'Sam' }}><AccountMenu /></SessionUserProvider>)
    expect(html).toContain('Sam')
  })

  it("signed in from the server: doesn't ask who it is", async () => {
    await mount({ id: 'u1', displayName: 'Sam' })
    expect(container.textContent).toContain('Sam')
    expect(calls().some(u => u.includes('/auth/me'))).toBe(false)
  })

  it('signed out from the server: Sign in, and no requests at all', async () => {
    await mount(null)
    expect(container.textContent).toContain('Sign in')
    expect(calls()).toEqual([])
  })

  it("when the server couldn't tell: asks, as before", async () => {
    await mount(undefined)
    expect(calls()).toContain('/att/api/auth/me')
    expect(container.textContent).toContain('Asked')
  })

  // The header shows it twice (dropdown + the phone's You tab).
  it('two copies on one page share each request', async () => {
    await mount(undefined, true)
    expect(calls().filter(u => u.includes('/auth/me'))).toHaveLength(1)
    expect(calls().filter(u => u.includes('pendingCount'))).toHaveLength(1)
    expect(container.textContent).toContain('Asked')
    expect(container.textContent).toContain('You')
  })

  // Accounts made with Strava (removed 2026-11) can't sign back in by themselves.
  describe('signing out an account made with Strava', () => {
    const openAndSignOut = async () => {
      const toggle = container.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
      await act(async () => { toggle.click() })
      const out = [...container.querySelectorAll('button')].find(b => b.textContent === 'Sign out')!
      await act(async () => { out.click() })
    }
    const signedOut = () => calls().some(u => u.includes('/auth/logout'))

    it('asks first, with Email us, Sign out anyway and Cancel, and signs nobody out yet', async () => {
      await mount({ id: 'u1', displayName: 'Sam', placeholderEmail: true })
      await openAndSignOut()
      expect(container.textContent).toContain('You made this account with Strava, so you can’t sign back in until we move it to your email.')
      expect(container.querySelector('a[href="mailto:privacy@paddlesnitch.com"]')?.textContent).toBe('Email us')
      expect(signedOut()).toBe(false)
      const cancel = [...container.querySelectorAll('button')].find(b => b.textContent === 'Cancel')!
      await act(async () => { cancel.click() })
      expect(container.textContent).toContain('Sign out')
      expect(container.textContent).not.toContain('You made this account with Strava')
      expect(signedOut()).toBe(false)
    })

    it('Sign out anyway signs out', async () => {
      const assign = vi.fn()
      vi.stubGlobal('location', { ...window.location, assign })
      await mount({ id: 'u1', displayName: 'Sam', placeholderEmail: true })
      await openAndSignOut()
      const anyway = [...container.querySelectorAll('button')].find(b => b.textContent === 'Sign out anyway')!
      await act(async () => { anyway.click() })
      expect(signedOut()).toBe(true)
    })

    it('when the menu had to ask who it is, a placeholder email from the answer is enough to ask first', async () => {
      await mount(undefined, false, 'strava-1@noreply.paddlesnitch.com')
      await openAndSignOut()
      expect(container.textContent).toContain('You made this account with Strava')
      expect(signedOut()).toBe(false)
      // The email itself is never shown.
      expect(container.textContent).not.toContain('noreply')
    })

    it('in the phone\'s You tab too', async () => {
      container = document.createElement('div'); document.body.appendChild(container)
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { data: 0 } }))))
      root = createRoot(container)
      await act(async () => { root.render(<SessionUserProvider user={{ id: 'u1', displayName: 'Sam', placeholderEmail: true }}><AccountMenu variant="tab" /></SessionUserProvider>) })
      await openAndSignOut()
      expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain('You made this account with Strava')
      expect(container.querySelector('[role="menu"]')).toBeNull()
    })

    it('closing and opening the menu again shows the menu, not the question', async () => {
      await mount({ id: 'u1', displayName: 'Sam', placeholderEmail: true })
      await openAndSignOut()
      const toggle = container.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
      await act(async () => { toggle.click() })
      await act(async () => { toggle.click() })
      expect(container.querySelector('[role="menu"]')).not.toBeNull()
      expect(container.textContent).not.toContain('You made this account with Strava')
    })

    it('Escape in the question goes back to the menu', async () => {
      await mount({ id: 'u1', displayName: 'Sam', placeholderEmail: true })
      await openAndSignOut()
      await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
      expect(container.querySelector('[role="menu"]')).not.toBeNull()
      expect(signedOut()).toBe(false)
    })

    it('any other account signs out at once', async () => {
      const assign = vi.fn()
      vi.stubGlobal('location', { ...window.location, assign })
      await mount({ id: 'u1', displayName: 'Sam' })
      await openAndSignOut()
      expect(container.textContent).not.toContain('You made this account with Strava')
      expect(signedOut()).toBe(true)
    })
  })
})
