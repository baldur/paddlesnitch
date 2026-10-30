// @vitest-environment jsdom
// Account's Google section (Connect Google): each state, as someone sees it.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

let search = new URLSearchParams()
vi.mock('next/navigation', () => ({ useSearchParams: () => search }))
import GoogleConnect from './GoogleConnect'

let container: HTMLDivElement
let root: Root
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
  search = new URLSearchParams()
})

const status = (over: object = {}) => ({ signsInWithGoogle: false, connected: false, email: 'me@example.com', canConnect: true, emailProven: true, canDisconnect: false, ...over })
async function mount(answer: object | null | 'pending', props: Partial<{ onSignInAgain: () => void; signingIn: boolean; signInError: string }> = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (answer === 'pending') return new Promise(() => {})
    return answer === null ? new Response('', { status: 500 }) : Response.json(answer)
  }))
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<GoogleConnect onSignInAgain={props.onSignInAgain ?? (() => {})} signingIn={props.signingIn ?? false} signInError={props.signInError ?? ''} />) })
  return container
}
const text = () => container.textContent ?? ''

describe('the Google section', () => {
  it('checking, and couldn\'t check', async () => {
    await mount('pending')
    expect(text()).toContain('Checking…')
    await act(async () => { root.unmount() }); container.remove()
    await mount(null)
    expect(text()).toContain('Couldn’t check Google. Please reload the page.')
  })

  it('not connected: names the email and offers Continue with Google, a POST to google/link', async () => {
    const c = await mount(status())
    expect(text()).toContain('It must be the Google account for me@example.com.')
    const form = c.querySelector('form[action="/att/api/auth/google/link"]')!
    expect(form.getAttribute('method')).toBe('post')
    expect(form.textContent).toContain('Continue with Google')
  })

  it('an email never proved: a code first, no Google button', async () => {
    const c = await mount(status({ emailProven: false }))
    expect(text()).toContain('first confirm that me@example.com is yours')
    expect(c.querySelector('form[action="/att/api/auth/google/link"]')).toBeNull()
    expect([...c.querySelectorAll('button')].some(b => b.textContent === 'Send code')).toBe(true)
  })

  it('an account that can\'t connect says why, with no button', async () => {
    const c = await mount(status({ canConnect: false }))
    expect(text()).toContain('needs an email address you’ve confirmed')
    expect(c.querySelector('form')).toBeNull()
  })

  it('connected: the badge and Disconnect; a Google account has no Disconnect', async () => {
    let c = await mount(status({ connected: true, canDisconnect: true }))
    expect(text()).toContain('You can sign in with Google or your email.')
    expect(c.querySelector('form[action="/att/api/auth/google/unlink"]')).not.toBeNull()
    await act(async () => { root.unmount() }); container.remove()
    c = await mount(status({ connected: true, signsInWithGoogle: true }))
    expect(text()).toContain('You sign in with Google.')
    expect(c.querySelector('form')).toBeNull()
  })

  it('needing a recent sign-in: the box, its error, and no Google button meanwhile', async () => {
    search = new URLSearchParams('google=reauth')
    const onSignInAgain = vi.fn()
    const c = await mount(status(), { onSignInAgain, signInError: 'Couldn’t start signing in again. Please try again.' })
    expect(text()).toContain('connecting Google needs a recent sign-in')
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t start signing in again')
    expect(c.querySelector('form[action="/att/api/auth/google/link"]')).toBeNull()
    const btn = [...c.querySelectorAll('button')].find(b => b.textContent === 'Sign in again')!
    await act(async () => { btn.click() })
    expect(onSignInAgain).toHaveBeenCalled()
  })

  it('results: connected is a status, a failure an alert, a cancel quiet, an unknown key nothing', async () => {
    for (const [key, role] of [['connected', 'status'], ['different_email', 'alert'], ['google_denied', 'status']] as const) {
      search = new URLSearchParams(`google=${key}`)
      const c = await mount(status())
      expect(c.querySelector(`[role="${role}"]`), key).not.toBeNull()
      await act(async () => { root.unmount() }); container.remove()
    }
    search = new URLSearchParams('google=whatever')
    const c = await mount(status())
    expect(c.querySelector('[role="alert"], [role="status"]')).toBeNull()
  })

  it('different_email names the email to use', async () => {
    search = new URLSearchParams('google=different_email')
    await mount(status())
    expect(text()).toContain('Choose the Google account for me@example.com.')
  })
})
