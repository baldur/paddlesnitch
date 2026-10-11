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
async function mount(user: { id: string; displayName: string } | null | undefined) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes('/auth/me') ? { id: 'u9', displayName: 'Asked' } : { result: { data: 0 } },
  ))))
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<SessionUserProvider user={user}><AccountMenu /></SessionUserProvider>) })
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

  it('signed out from the server: SIGN IN, and no requests at all', async () => {
    await mount(null)
    expect(container.textContent).toContain('SIGN IN')
    expect(calls()).toEqual([])
  })

  it("when the server couldn't tell: asks, as before", async () => {
    await mount(undefined)
    expect(calls()).toContain('/att/api/auth/me')
    expect(container.textContent).toContain('Asked')
  })
})
