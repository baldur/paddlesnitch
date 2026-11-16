import { describe, it, expect } from 'vitest'
import { agreement, mae, splitByIndex, spearman } from './agreement'

describe('mae', () => {
  it('is the mean absolute difference, over the views both have', () => {
    const model = { a: 3, b: 2, c: 5 }
    const owner = { a: 3, b: 4, c: 3, d: 1 }
    expect(mae(model, owner)).toBeCloseTo((0 + 2 + 2) / 3, 6)
  })
  it('restricts to the given ids', () => {
    const model = { a: 1, b: 5 }
    const owner = { a: 5, b: 1 }
    expect(mae(model, owner, ['a'])).toBe(4)
    expect(mae(model, owner, ['b'])).toBe(4)
  })
  it('is NaN when nothing matches', () => {
    expect(Number.isNaN(mae({ a: 3 }, { b: 3 }))).toBe(true)
  })
})

describe('spearman', () => {
  it('is 1 when the ranks agree exactly', () => {
    expect(spearman({ a: 1, b: 2, c: 3, d: 4 }, { a: 1, b: 2, c: 3, d: 4 })).toBeCloseTo(1, 10)
  })
  it('is -1 when the ranks reverse', () => {
    expect(spearman({ a: 4, b: 3, c: 2, d: 1 }, { a: 1, b: 2, c: 3, d: 4 })).toBeCloseTo(-1, 10)
  })
  it('shares a rank when scores tie (the x=[1,2,2,4], y=[1,2,3,4] example)', () => {
    // model ranks 1, 2.5, 2.5, 4 (the two 2s average positions 2 and 3) against
    // owner ranks 1, 2, 3, 4 -> 0.9487.
    expect(spearman({ a: 1, b: 2, c: 2, d: 3 }, { a: 1, b: 2, c: 3, d: 4 })).toBeCloseTo(0.9487, 3)
  })
  it('is NaN with fewer than three views', () => {
    expect(Number.isNaN(spearman({ a: 1 }, { a: 1 }))).toBe(true)
  })
})

describe('splitByIndex', () => {
  it('splits the order of views.json into even and odd', () => {
    const { even, odd } = splitByIndex(['a', 'b', 'c', 'd', 'e'])
    expect(even).toEqual(['a', 'c', 'e'])
    expect(odd).toEqual(['b', 'd'])
  })
})

describe('agreement', () => {
  // 6 views; the owner scored all, the model has all but the last odd one.
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  const owner = { a: 3, b: 4, c: 2, d: 5, e: 1, f: 3 }
  const model = { a: 3, b: 3, c: 3, d: 4, e: 2, f: 3 }
  it('reports the counts and the four numbers', () => {
    const r = agreement(model, owner, ids)
    expect(r.of).toBe(6)
    expect(r.n).toBe(6)
    // even indices 0,2,4: a,c,e -> diffs 0,1,1 ; odd 1,3,5: b,d,f -> 1,1,0
    expect(r.even).toBe(3)
    expect(r.odd).toBe(3)
    expect(r.maeEven).toBeCloseTo((0 + 1 + 1) / 3, 6)
    expect(r.maeHeldOut).toBeCloseTo((1 + 1 + 0) / 3, 6)
    expect(r.mae).toBeCloseTo((0 + 1 + 1 + 1 + 1 + 0) / 6, 6)
    expect(Number.isFinite(r.spearman)).toBe(true)
  })
})
