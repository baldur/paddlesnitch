import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import path from 'path'
import { GUIDE_STEPS, guideStep, setupProgress } from './guide'

describe('tracker setup guide', () => {
  it('creates the account before the tracker is switched on (its code changes every few minutes)', () => {
    const order = GUIDE_STEPS.map(s => s.slug)
    expect(order.indexOf('account')).toBeLessThan(order.indexOf('switch-on'))
    expect(order.indexOf('wifi')).toBeLessThan(order.indexOf('link'))
  })

  it('numbers the steps and links each to its neighbours', () => {
    expect(guideStep('account')).toMatchObject({ number: 1, prev: undefined, next: { slug: 'switch-on' } })
    const last = GUIDE_STEPS.at(-1)!
    expect(guideStep(last.slug)).toMatchObject({ number: GUIDE_STEPS.length, next: undefined })
    expect(guideStep('nope')).toBeUndefined()
  })

  it('has a page for every step', () => {
    for (const s of GUIDE_STEPS) {
      expect(existsSync(path.join(__dirname, '../app/guide', s.slug, 'page.tsx')), s.slug).toBe(true)
    }
    expect(existsSync(path.join(__dirname, '../app/guide/troubleshooting/page.tsx'))).toBe(true)
  })
})

describe('getting started checklist', () => {
  const done = (t: Parameters<typeof setupProgress>[0]) => setupProgress(t).items.map(i => i.done)

  it('starts with only the account done', () => {
    expect(done([])).toEqual([true, false, false])
    expect(setupProgress([]).complete).toBe(false)
  })
  it('ticks the tracker once one is on the account', () => {
    expect(done([{ linked: true, sessions: 0 }])).toEqual([true, true, false])
  })
  it('is complete once a recording has arrived, and then goes away', () => {
    expect(setupProgress([{ linked: true, sessions: 1 }]).complete).toBe(true)
  })
  it('does not count a removed tracker as set up', () => {
    expect(done([{ linked: false, sessions: 0 }])).toEqual([true, false, false])
  })
  it('links every item to a guide step', () => {
    for (const i of setupProgress([]).items) expect(i.href).toMatch(/^\/guide\/[a-z-]+$/)
  })
})
