// @vitest-environment jsdom
// #712: Disconnect Strava asks first, and an account made with Sign in with
// Strava is told it can't sign in afterwards.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import StravaConnection from './StravaConnection'

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove() })

async function mount(props: { stravaOnly?: boolean; canDisconnect?: boolean; onDisconnect?: () => void }) {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <StravaConnection canDisconnect={props.canDisconnect ?? true} stravaOnly={props.stravaOnly ?? false}
        disconnecting={false} onDisconnect={props.onDisconnect ?? (() => {})}>
        <span>Ann Paddler</span>
      </StravaConnection>,
    )
  })
}
const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label)
const click = (label: string) => act(async () => { button(label)!.click() })
const LOCKED_OUT = 'You sign in with Strava. Once it’s disconnected, you can’t sign in to this account until you connect it again.'

describe('Disconnect Strava', () => {
  it('asks first, and disconnects only once confirmed', async () => {
    const onDisconnect = vi.fn()
    await mount({ onDisconnect })
    await click('Disconnect')
    expect(onDisconnect).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Disconnect Strava? New paddles stop coming in from Strava, and you can’t sign in with it.')
    expect(container.textContent).not.toContain(LOCKED_OUT)
    await click('Disconnect')
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('Keep leaves Strava connected', async () => {
    const onDisconnect = vi.fn()
    await mount({ onDisconnect })
    await click('Disconnect')
    await click('Keep')
    expect(onDisconnect).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('Disconnect Strava?')
    expect(button('Disconnect')).toBeTruthy()
  })

  it('tells an account made with Sign in with Strava it can’t sign in afterwards', async () => {
    const onDisconnect = vi.fn()
    await mount({ stravaOnly: true, onDisconnect })
    expect(container.textContent).not.toContain(LOCKED_OUT)
    await click('Disconnect')
    expect(container.textContent).toContain(LOCKED_OUT)
    expect(onDisconnect).not.toHaveBeenCalled()
    await click('Disconnect')
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('has no Disconnect when it can’t be offered', async () => {
    await mount({ canDisconnect: false })
    expect(button('Disconnect')).toBeUndefined()
    expect(container.textContent).toContain('Ann Paddler')
  })
})
