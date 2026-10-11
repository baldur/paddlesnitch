// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { useIsClient } from './use-is-client'

function Probe() { return <span>{useIsClient() ? 'client' : 'server'}</span> }

describe('useIsClient', () => {
  it('is false in the server HTML, so the placeholder is what hydrates', () => {
    expect(renderToString(<Probe />)).toContain('server')
  })

  it('is true once rendered in the browser', async () => {
    const el = document.createElement('div')
    const root = createRoot(el)
    await act(async () => { root.render(<Probe />) })
    expect(el.textContent).toBe('client')
    await act(async () => { root.unmount() })
  })
})
