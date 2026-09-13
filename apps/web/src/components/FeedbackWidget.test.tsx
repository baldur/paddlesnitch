// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import FeedbackWidget from '@paddlesnitch/ui/FeedbackWidget'

// The report widget is now the shared @paddlesnitch/ui one; the header REPORT
// link (in AppShell) opens it via a `paddlesnitch:open-feedback` window event.
// This pins that event contract.

let container: HTMLDivElement
let root: Root

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
})

async function mount(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(node) })
}

describe('shared FeedbackWidget ↔ header trigger', () => {
  it('opens the modal when a paddlesnitch:open-feedback event fires', async () => {
    await mount(<FeedbackWidget />)
    // Closed: the floating trigger shows, the form does not.
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).toContain('REPORT AN ISSUE')

    await act(async () => {
      window.dispatchEvent(new CustomEvent('paddlesnitch:open-feedback'))
    })
    // Open: the report form (textarea) is now mounted.
    expect(container.querySelector('textarea')).not.toBeNull()
  })
})
