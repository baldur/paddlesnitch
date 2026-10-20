import { readFileSync } from 'fs'
import { test, expect } from '@playwright/test'

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

for (const url of PAGES) {
  test(`axe finds nothing to fix on ${url}`, async ({ page }) => {
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.addScriptTag({ content: AXE })
    const violations = await page.evaluate(async () => {
      const r = await (window as unknown as { axe: { run: (d: Document, o: object) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } })
        .axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })
      return r.violations.map(v => ({ id: v.id, impact: v.impact, at: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }))
    })
    expect(violations.filter(v => ALWAYS.has(v.id) || v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  })
}
