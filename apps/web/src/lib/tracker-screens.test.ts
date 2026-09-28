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

  it('splits example values from the fixed text', () => {
    expect(literalFragments('on device ‹3›')).toEqual(['on device'])
    expect(literalFragments('‹K7P2QM›')).toEqual([])
    expect(shown('Updated to ‹0.16.3›')).toBe('Updated to 0.16.3')
  })

  it('catches text the firmware does not have', () => {
    expect(source).not.toContain('Tracker ready to paddle')
  })
})
