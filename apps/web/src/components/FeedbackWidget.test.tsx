// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import FeedbackWidget, { ReportIssueButton } from '@paddlesnitch/ui/FeedbackWidget'

// The report widget is now the shared @paddlesnitch/ui one; the header REPORT
// link (in AppShell) opens it via a `paddlesnitch:open-feedback` window event.
// This pins that event contract.

let container: HTMLDivElement
let root: Root

afterEach(async () => {
  vi.unstubAllGlobals()
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

  it('opens by itself on a page opened with ?report=1 (the apps link there)', async () => {
    window.history.replaceState(null, '', '/signin?report=1')
    try {
      await mount(<FeedbackWidget />)
      expect(container.querySelector('textarea')).not.toBeNull()
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('stays closed without it', async () => {
    await mount(<FeedbackWidget />)
    expect(container.querySelector('textarea')).toBeNull()
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

// #507: the widget said "Thanks, your report has been sent" when nothing was filed.
describe('FeedbackWidget submit', () => {
  async function openForm() {
    await mount(<FeedbackWidget />)
    await act(async () => { window.dispatchEvent(new CustomEvent('paddlesnitch:open-feedback')) })
    return {
      textarea: container.querySelector('textarea')!,
      send: [...container.querySelectorAll('button')].find(b => b.textContent === 'Send report')!,
    }
  }
  // Sets the value the way autofill or automation can: through React's tracked
  // setter, so React's onChange never fires, then a plain input event.
  async function fillWithoutReactChange(el: HTMLTextAreaElement, value: string) {
    await act(async () => {
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('keeps Send disabled while the description is empty or only spaces', async () => {
    const { textarea, send } = await openForm()
    expect(send.disabled).toBe(true)
    await fillWithoutReactChange(textarea, '      ')
    expect(send.disabled).toBe(true)
  })

  it('sends the description from the form even when it was filled without a React change event', async () => {
    const fetchMock = stubFetch(200, { ok: true, issueNumber: 7, url: 'https://github.com/x/y/issues/7' })
    const { textarea, send } = await openForm()
    await fillWithoutReactChange(textarea, 'The map never loads on the plan page.')
    expect(send.disabled).toBe(false)
    await act(async () => { send.click() })
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    expect(JSON.parse(calls[0][1].body as string).description).toBe('The map never loads on the plan page.')
    expect(container.textContent).toContain('Thanks, your report has been sent')
    const link = container.querySelector('a[href="https://github.com/x/y/issues/7"]')
    expect(link).not.toBeNull()
  })

  it('does not say "sent" when the server answers OK but filed no issue', async () => {
    stubFetch(200, { ok: true })
    const { textarea, send } = await openForm()
    await fillWithoutReactChange(textarea, 'The map never loads on the plan page.')
    await act(async () => { send.click() })
    expect(container.textContent).not.toContain('has been sent')
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('shows the server error when the report is refused', async () => {
    stubFetch(400, { error: 'Please write at least 10 characters describing what went wrong.' })
    const { textarea, send } = await openForm()
    await fillWithoutReactChange(textarea, 'The map never loads on the plan page.')
    await act(async () => { send.click() })
    expect(container.textContent).not.toContain('has been sent')
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('at least 10 characters')
  })
})
