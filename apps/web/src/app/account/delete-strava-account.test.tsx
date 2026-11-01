// @vitest-environment jsdom
// Delete account for an account made with Strava (removed 2026-11): it can't
// sign in again, so instead of "Sign in again" it offers Email us, with the
// Support ID filled in. Any other account is asked to sign in again, as before.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/AppHeader', () => ({ default: () => null }))
vi.mock('@/components/GoogleConnect', () => ({ default: () => null }))
import AccountPage from './page'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove(); vi.unstubAllGlobals() })

async function openDeleteAs(email: string) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url === '/att/api/auth/me' ? { id: 'user-1', email, displayName: 'Sam' }
      : url === '/api/account' ? { recentSignIn: false }
        : url === '/api/account/contact' ? { contact: null, placeholderEmail: email.startsWith('strava-') }
          : {},
  ))))
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<AccountPage />) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  const del = [...container.querySelectorAll('button')].find(b => b.textContent === 'Delete my account')!
  await act(async () => { del.click() })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

describe('Delete account', () => {
  it('made with Strava: Email us, with the subject and Support ID, instead of signing in again', async () => {
    await openDeleteAs('strava-123@noreply.paddlesnitch.com')
    const link = container.querySelector('a[href^="mailto:privacy@paddlesnitch.com?subject="]')!
    expect(container.textContent).toContain('An account made with Strava can’t sign in again here. Email us and we’ll delete it.')
    expect(link.textContent?.trim()).toBe('Email us')
    const href = new URL(link.getAttribute('href')!)
    expect(href.searchParams.get('subject')).toBe('Delete my account')
    expect(href.searchParams.get('body')).toContain('user-1')
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Sign in again')).toBe(false)
    expect(container.textContent).not.toContain('Report an issue')
  })

  it('any other account: Sign in again, as before', async () => {
    await openDeleteAs('sam@example.com')
    expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Sign in again')).toBe(true)
    expect(container.textContent).not.toContain('An account made with Strava')
  })

  it('says the trackers are removed, and nothing about Strava', async () => {
    await openDeleteAs('sam@example.com')
    expect(container.textContent).toContain('Your trackers are removed.')
    expect(container.textContent).not.toMatch(/Strava is disconnected|unlinked/)
  })
})
