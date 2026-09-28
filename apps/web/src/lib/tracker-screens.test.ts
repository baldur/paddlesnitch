// The guide draws the tracker's screen. Every piece of text in those drawings
// (other than ‹example› values) must still be in the firmware, so a firmware
// wording change fails here rather than leaving the guide showing a screen the
// tracker no longer has.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { SCREENS, literalFragments, shown } from './tracker-screens'

const fw = path.resolve(__dirname, '../../../../firmware')
const source = ['src', 'include']
  .flatMap(d => readdirSync(path.join(fw, d)).filter(f => /\.(cpp|h)$/.test(f)).map(f => readFileSync(path.join(fw, d, f), 'utf8')))
  .join('\n')

const texts = Object.entries(SCREENS).flatMap(([name, s]) =>
  s.els.flatMap(e => ('text' in e ? [[name, e.text] as const] : [])))

describe('tracker screen drawings', () => {
  it.each(texts)('%s: "%s" is text the firmware shows', (_name, text) => {
    for (const frag of literalFragments(text)) expect(source, frag).toContain(frag)
  })

  // The panel is 128 px. In the fixed-width fonts a character is 5 (s) or 6 (m)
  // px, less the last glyph's blank column. Four lines of firmware text once ran
  // off the edge (the Stop? screen read "...keep g"); drawing them here now
  // fails instead.
  it.each(Object.entries(SCREENS).flatMap(([name, s]) => s.els.flatMap(e =>
    'text' in e && (e.font === 's' || e.font === 'm') ? [[name, e] as const] : [])))(
    '%s: every line fits the 128 px screen', (_name, e) => {
      const w = shown(e.text).length * (e.font === 's' ? 5 : 6) - 1
      const left = e.align === 'right' ? e.x - w : e.align === 'center' ? e.x - w / 2 : e.x
      expect(left, e.text).toBeGreaterThanOrEqual(0)
      expect(left + w, e.text).toBeLessThanOrEqual(128)
    })

  it('splits example values from the fixed text', () => {
    expect(literalFragments('on device ‹3›')).toEqual(['on device'])
    expect(literalFragments('‹K7P2QM›')).toEqual([])
    expect(shown('Updated to ‹0.16.3›')).toBe('Updated to 0.16.3')
  })

  it('catches text the firmware does not have', () => {
    expect(source).not.toContain('Tracker ready to paddle')
  })
})
