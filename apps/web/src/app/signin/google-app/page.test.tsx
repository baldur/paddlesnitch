// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import GoogleAppSignIn from './page'

const challenge = 'c'.repeat(43)
const render = async (q: Record<string, string>) => renderToStaticMarkup(await GoogleAppSignIn({ searchParams: Promise.resolve(q) }))

describe('/signin/google-app', () => {
  it('asks for a tap: a form that POSTs the challenge and nonce back to init', async () => {
    const html = await render({ challenge, n: 'nonce-1' })
    expect(html).toContain('action="/att/api/auth/google/init"')
    expect(html).toContain('method="post"')
    expect(html).toContain(`name="challenge" value="${challenge}"`)
    expect(html).toContain('name="n" value="nonce-1"')
    expect(html).toContain('Sign in with Google')
  })

  it('says what went wrong, with no button, when it was opened without them', async () => {
    for (const q of [{}, { challenge }, { challenge: "short", n: "x" }] as Record<string, string>[]) {
      const html = await render(q)
      expect(html).not.toContain('<form')
      expect(html).toContain('Go back to the app and try again.')
    }
  })
})
