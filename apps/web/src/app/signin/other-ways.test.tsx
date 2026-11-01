// @vitest-environment jsdom
// The sign-in page's other way in (Google) follows the build switch
// (lib/sign-in-options.ts), which the page reads once when it loads. Accounts
// made with Strava (removed 2026-11) are told how to get back in.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => search,
}))

let container: HTMLDivElement
let root: Root
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.unstubAllEnvs()
  search = new URLSearchParams()
})

async function mountWith(env: { google?: boolean }) {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_SIGNIN', env.google ? '1' : '')
  vi.resetModules()
  const { default: AuthPage } = await import('./page')
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<AuthPage />) })
  return container
}

describe('other ways in', () => {
  it('Google, when it is switched on', async () => {
    const c = await mountWith({ google: true })
    expect(c.textContent).toContain('Or use your Google account')
    expect(c.querySelector('a[href^="/att/api/auth/google/init"]')).not.toBeNull()
  })

  it('no Strava button, whatever the switches', async () => {
    const c = await mountWith({ google: true })
    expect(c.querySelector('a[href*="/strava/"]')).toBeNull()
    expect(c.textContent).not.toContain('Strava account')
  })

  it('Google off: no section at all', async () => {
    const c = await mountWith({})
    expect(c.textContent).not.toContain('Or use your')
    expect(c.querySelector('a[href*="/google/init"]')).toBeNull()
  })

  it('accounts made with Strava are told, on Sign in, to email us (not to file a public report)', async () => {
    for (const google of [true, false]) {
      const c = await mountWith({ google })
      expect(c.textContent).toContain('Made your account with Strava? Email us and we’ll move it to your email.')
      const link = c.querySelector('a[href="mailto:privacy@paddlesnitch.com"]')
      expect(link?.textContent).toBe('Email us')
      expect(c.textContent).not.toContain('Strava sign-in is off')
      await act(async () => { root.unmount() }); container.remove()
    }
  })

  it('the Strava line is not on Create account', async () => {
    const c = await mountWith({})
    const createTab = [...c.querySelectorAll('button')].find(b => b.textContent === 'Create account')!
    await act(async () => { createTab.click() })
    expect(c.textContent).not.toContain('Made your account with Strava?')
  })

  it('an existing-account message doesn\'t point to Strava', async () => {
    search = new URLSearchParams('error=google_account_exists')
    const c = await mountWith({ google: true })
    expect(c.textContent).toContain('Sign in with your email instead.')
  })

  it('back to sign in again before connecting Google: says why', async () => {
    search = new URLSearchParams('reason=reauth_google&next=%2Faccount%23google')
    const c = await mountWith({ google: true })
    expect(c.textContent).toContain('For your safety, connecting Google needs a recent sign-in.')
  })
})
