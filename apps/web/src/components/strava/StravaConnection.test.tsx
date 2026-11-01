// @vitest-environment jsdom
// #712: Disconnect Strava asks first, and says what signing in with Strava
// would do afterwards for this kind of account.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import StravaConnection from './StravaConnection'

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove() })

async function mount(props: { stravaOnly?: boolean; canDisconnect?: boolean; disconnecting?: boolean; onDisconnect?: () => void }) {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <StravaConnection canDisconnect={props.canDisconnect ?? true} stravaOnly={props.stravaOnly ?? false}
        disconnecting={props.disconnecting ?? false} onDisconnect={props.onDisconnect ?? (() => {})}>
        <span>Ann Paddler</span>
      </StravaConnection>,
    )
  })
}
const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label)
const click = (label: string) => act(async () => { button(label)!.click() })
const QUESTION = 'Disconnect Strava? New paddles stop coming in from Strava. Paddles already here stay.'
const NEW_ACCOUNT = 'Signing in with Strava would then start a new, empty account.'
const GET_BACK_IN = 'You sign in with Strava. To get back in later, use Sign in with Strava, which connects it again.'

describe('Disconnect Strava', () => {
  it('asks first, and disconnects only once confirmed', async () => {
    const onDisconnect = vi.fn()
    await mount({ onDisconnect })
    await click('Disconnect')
    expect(onDisconnect).not.toHaveBeenCalled()
    expect(container.textContent).toContain(QUESTION)
    expect(container.textContent).toContain(NEW_ACCOUNT)
    expect(container.textContent).not.toContain(GET_BACK_IN)
    await click('Disconnect')
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('Keep leaves Strava connected, and focus goes back to Disconnect', async () => {
    const onDisconnect = vi.fn()
    await mount({ onDisconnect })
    await click('Disconnect')
    expect(document.activeElement).toBe(button('Keep'))
    await click('Keep')
    expect(onDisconnect).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Disconnect Strava?')
    expect(document.activeElement).toBe(button('Disconnect'))
  })

  it('tells an account made with Sign in with Strava how to get back in', async () => {
    const onDisconnect = vi.fn()
    await mount({ stravaOnly: true, onDisconnect })
    expect(container.textContent).not.toContain(GET_BACK_IN)
    await click('Disconnect')
    expect(container.textContent).toContain(QUESTION)
    expect(container.textContent).toContain(GET_BACK_IN)
    expect(container.textContent).not.toContain(NEW_ACCOUNT)
    expect(onDisconnect).not.toHaveBeenCalled()
    await click('Disconnect')
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('has no Disconnect when it can’t be offered', async () => {
    await mount({ canDisconnect: false })
    expect(button('Disconnect')).toBeUndefined()
    expect(container.textContent).toContain('Ann Paddler')
  })

  it('says Disconnecting… and can’t be pressed while it runs', async () => {
    await mount({ disconnecting: true })
    expect(button('Disconnecting…')?.disabled).toBe(true)
  })
})
