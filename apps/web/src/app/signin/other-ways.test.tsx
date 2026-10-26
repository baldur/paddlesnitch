// @vitest-environment jsdom
// The sign-in page's other ways in (Google, Strava) follow the build switches
// (lib/sign-in-options.ts), which the page reads once when it loads.
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

async function mountWith(env: { google?: boolean; strava?: boolean }) {
  vi.stubEnv('NEXT_PUBLIC_GOOGLE_SIGNIN', env.google ? '1' : '')
  vi.stubEnv('NEXT_PUBLIC_STRAVA_OFF', env.strava === false ? '1' : '')
  vi.resetModules()
  const { default: AuthPage } = await import('./page')
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<AuthPage />) })
  return container
}

describe('other ways in', () => {
  it('Google and Strava', async () => {
    const c = await mountWith({ google: true, strava: true })
    expect(c.textContent).toContain('Or use your Google or Strava account')
    expect(c.querySelector('a[href^="/att/api/auth/google/init"]')).not.toBeNull()
    expect(c.querySelector('a[href^="/att/api/auth/strava/init"]')).not.toBeNull()
    expect(c.textContent).toContain('then connect Strava in Account')
  })

  it('Google only, when Strava is switched off', async () => {
    const c = await mountWith({ google: true, strava: false })
    expect(c.textContent).toContain('Or use your Google account')
    expect(c.textContent).not.toMatch(/Strava/)
    expect(c.querySelector('a[href^="/att/api/auth/strava/init"]')).toBeNull()
  })

  it('Strava only, when Google is off', async () => {
    const c = await mountWith({ strava: true })
    expect(c.textContent).toContain('Or use your Strava account')
    expect(c.querySelector('a[href^="/att/api/auth/google/init"]')).toBeNull()
  })

  it('neither: no section at all', async () => {
    const c = await mountWith({ strava: false })
    expect(c.textContent).not.toContain('Or use your')
    expect(c.textContent).not.toMatch(/Strava|Google/)
  })

  it('an existing-account message without Strava doesn\'t point to Strava', async () => {
    search = new URLSearchParams('error=google_account_exists')
    const c = await mountWith({ google: true, strava: false })
    expect(c.textContent).toContain('Sign in with your email instead.')
  })
})
