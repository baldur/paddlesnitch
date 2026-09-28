// Every fixed line of text the tracker draws must fit its 128 px screen.
// Four lines once ran off the edge on the device itself (the Stop? screen read
// "...keep g"), and nothing noticed. The firmware has no display in its host
// tests, so this reads the source: it follows setFont() and checks each
// drawStr / snprintf / const char* literal drawn in a fixed-width font.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const fw = path.resolve(__dirname, '../../../../firmware/src')
const ADVANCE: Record<string, number> = { u8g2_font_5x8_tf: 5, u8g2_font_6x10_tf: 6 }

type Line = { where: string; text: string; px: number }

function lines(file: string): Line[] {
  const out: Line[] = []
  let font = ''
  readFileSync(path.join(fw, file), 'utf8').split('\n').forEach((l, i) => {
    const f = /setFont\((u8g2_font_\w+)\)/.exec(l)
    if (f) font = f[1]
    const adv = ADVANCE[font]
    if (!adv) return
    const where = `${file}:${i + 1}`
    for (const m of l.matchAll(/drawStr\(\s*(\d+)\s*,\s*\d+\s*,\s*"([^"]*)"/g)) {
      out.push({ where, text: m[2], px: Number(m[1]) + m[2].length * adv - 1 })
    }
    for (const m of l.matchAll(/(?:snprintf\(\w+, sizeof\(\w+\), |const char \*\w+ = )"([^"%]+)"/g)) {
      out.push({ where, text: m[1], px: m[1].length * adv - 1 })
    }
  })
  return out
}

describe('tracker screen text', () => {
  const all = ['ui.cpp', 'netcfg.cpp'].flatMap(lines)

  it('finds the text to check', () => {
    expect(all.length).toBeGreaterThan(30)
    expect(all.map(l => l.text)).toContain('HOLD to stop')
  })

  it('every fixed line fits the 128 px screen', () => {
    expect(all.filter(l => l.px > 128).map(l => `${l.where} ${l.px}px "${l.text}"`)).toEqual([])
  })
})
