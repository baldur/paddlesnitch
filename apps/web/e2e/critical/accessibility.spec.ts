import { readFileSync } from 'fs'
import { test, expect, type Page } from '@playwright/test'
import { signUpFlow } from '../helpers'

// Every public page passes axe (#510): no unlabelled buttons, links or form
// fields, one main landmark, and nothing axe calls serious or critical. One
// test per page, so a failure names the page.

const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
// Always failures, whatever impact axe gives them.
const ALWAYS = new Set(['button-name', 'link-name', 'label', 'image-alt', 'landmark-one-main', 'aria-required-children', 'aria-valid-attr-value'])

const PAGES = [
  '/',
  '/plan?from=51.399410,-1.347414&to=51.400405,-1.134311',   // Guyers Lock to Aldermaston Wharf: a route and its stops
  '/plan/gaps',
  '/att',
  '/paddles',
  '/help',
  '/signin',
  '/terms',
]

async function axeProblems(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.addScriptTag({ content: AXE })
  const violations = await page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (d: Document, o: object) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } })
      .axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })
    return r.violations.map(v => ({ id: v.id, impact: v.impact, at: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }))
  })
  return violations.filter(v => ALWAYS.has(v.id) || v.impact === 'serious' || v.impact === 'critical')
}

for (const url of PAGES) {
  test(`axe finds nothing to fix on ${url}`, async ({ page }) => {
    expect(await axeProblems(page, url)).toEqual([])
  })
}

// The pages only a signed-in paddler sees (#510). One account for all of them;
// the result is keyed by page, so a failure still names it.
const SIGNED_IN_PAGES = ['/paddles', '/plan', '/att', '/account', '/devices', '/buddies', '/profile/me']

test('axe finds nothing to fix on the signed-in pages', async ({ page }) => {
  test.setTimeout(120_000)
  await signUpFlow(page)
  const found: Record<string, unknown[]> = {}
  for (const url of SIGNED_IN_PAGES) found[url] = await axeProblems(page, url)
  expect(found).toEqual(Object.fromEntries(SIGNED_IN_PAGES.map(u => [u, []])))
})
