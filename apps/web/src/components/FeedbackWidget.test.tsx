// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import FeedbackWidget, { ReportIssueButton } from '@paddlesnitch/ui/FeedbackWidget'

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
    expect(container.textContent).toContain('Report an issue')

    await act(async () => {
      window.dispatchEvent(new CustomEvent('paddlesnitch:open-feedback'))
    })
    // Open: the report form (textarea) is now mounted.
    expect(container.querySelector('textarea')).not.toBeNull()
  })

  it('the footer Report button opens it (the way in on phones, where the floating button is hidden)', async () => {
    await mount(<><ReportIssueButton /><FeedbackWidget /></>)
    const floating = container.querySelector('button[aria-label="Report an issue"]')!
    expect(floating.className).toMatch(/(^| )hidden( |$)/)
    expect(floating.className).toContain('sm:block')

    const footerButton = [...container.querySelectorAll('button')].find(b => b.textContent === 'Report an issue')!
    await act(async () => { footerButton.click() })
    expect(container.querySelector('textarea')).not.toBeNull()
  })
})
