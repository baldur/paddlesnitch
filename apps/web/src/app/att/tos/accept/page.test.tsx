// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: replace }),
  useSearchParams: () => new URLSearchParams('next=/paddles'),
  usePathname: () => '/att/tos/accept',
}))
vi.mock('@/components/AppHeader', () => ({ default: () => <header /> }))

import AcceptTermsPage from './page'

let container: HTMLDivElement
let root: Root
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
  replace.mockClear()
})

async function mount(tos: { status: number; body?: unknown }) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST' ? new Response('{}', { status: 200 }) : new Response(JSON.stringify(tos.body ?? {}), { status: tos.status }))
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<AcceptTermsPage />) })
  await act(async () => { await Promise.resolve() })
  return fetchMock
}

describe('accept the Terms page', () => {
  it('records acceptance of the current version, then goes on to where they were going', async () => {
    const fetchMock = await mount({ status: 200, body: { accepted: false } })
    const button = container.querySelector('button[type=submit]') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await act(async () => { (container.querySelector('input[type=checkbox]') as HTMLInputElement).click() })
    expect(button.disabled).toBe(false)
    await act(async () => { button.click() })
    await act(async () => { await Promise.resolve() })
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1]!.body as string).version).toBeTruthy()
    expect(replace).toHaveBeenCalledWith('/paddles')
  })

  it('goes straight on when the Terms are already accepted', async () => {
    await mount({ status: 200, body: { accepted: true } })
    expect(replace).toHaveBeenCalledWith('/paddles')
  })

  it('sends someone who is signed out to sign in first', async () => {
    await mount({ status: 401 })
    expect(replace.mock.calls[0][0]).toMatch(/^\/att\/auth\?next=/)
  })
})
