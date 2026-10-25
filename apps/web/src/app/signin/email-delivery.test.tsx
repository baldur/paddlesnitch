// @vitest-environment jsdom
// While the site can't email people (SES sandbox: lib/email-delivery.ts), it
// mustn't offer what depends on an email: a tester picking EMAIL CODE or
// "forgot password" would wait for a code that never comes.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/strava/StravaButton', () => ({ default: () => null }))

import { EMAIL_DELIVERY, RESET_EMAIL } from '@/lib/email-delivery'
import AuthPage from './page'
import ForgotPasswordPage from './forgot/page'

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove() })
async function mount(node: React.ReactNode) {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(node) })
}

describe('sign-in while the site cannot send email', () => {
  it('is switched off until SES production access is granted', () => {
    expect(EMAIL_DELIVERY).toBe(false)
  })
  it('offers no Email code tab', async () => {
    await mount(<AuthPage />)
    expect(container.textContent).toContain('Create account')
    expect(container.textContent).not.toContain('Email code')
  })
  // Reset codes come from Cognito's own sender, which the SES sandbox
  // doesn't limit (infra/lib/att-stack.ts), so forgot password works.
  it('still offers a password reset by email: Cognito sends those codes', async () => {
    expect(RESET_EMAIL).toBe(true)
    await mount(<ForgotPasswordPage />)
    expect(container.textContent).not.toContain("We can't email reset codes yet")
    expect(container.querySelector('input[type="email"]')).not.toBeNull()
  })
})
