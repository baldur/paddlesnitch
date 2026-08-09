// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import FeedbackWidget from './FeedbackWidget'

// #157: the analyse site had no way to report an issue. This widget mirrors the
// ATT one and posts to the shared /att/api/feedback endpoint.

let container: HTMLDivElement
let root: Root

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.restoreAllMocks()
})

async function mount(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(node) })
}

describe('analyse FeedbackWidget (#157)', () => {
  it('shows the floating trigger and no form until opened', async () => {
    await mount(<FeedbackWidget />)
    expect(container.querySelector('textarea')).toBeNull()
    expect(container.textContent).toContain('REPORT AN ISSUE')

    const trigger = container.querySelector('button')
    await act(async () => { trigger!.click() })
    expect(container.querySelector('textarea')).not.toBeNull()
  })

  it('posts the report to /att/api/feedback and shows confirmation', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, url: 'https://github.com/baldur/paddlesnitch/issues/999' }),
    })) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    await mount(<FeedbackWidget />)
    await act(async () => { container.querySelector('button')!.click() })

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(textarea, 'The replay slider is stuck on the analyse page')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/att/api/feedback')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.description).toContain('replay slider')
    // anti-bot fields the shared endpoint expects
    expect(body).toHaveProperty('website')
    expect(body).toHaveProperty('elapsedMs')

    expect(container.textContent).toContain('your report has been filed')
  })
})
