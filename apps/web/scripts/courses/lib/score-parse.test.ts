import { describe, it, expect } from 'vitest'
import { clampScore, parseScoreAnswer } from './score-parse'

describe('clampScore', () => {
  it('keeps a 1-5 integer', () => {
    expect(clampScore(3)).toBe(3)
    expect(clampScore('4')).toBe(4)
    expect(clampScore(2.6)).toBe(3)
  })
  it('rejects out of range and non-numbers', () => {
    expect(clampScore(0)).toBeNull()
    expect(clampScore(6)).toBeNull()
    expect(clampScore('nope')).toBeNull()
    expect(clampScore(true)).toBeNull()
    expect(clampScore([4])).toBeNull()
  })
})

describe('parseScoreAnswer', () => {
  it('reads a bare JSON object', () => {
    const r = parseScoreAnswer('{"score":4,"differences":["flat water","low-poly trees"]}')
    expect(r.score).toBe(4)
    expect(r.differences).toEqual(['flat water', 'low-poly trees'])
  })
  it('reads an object wrapped in a code fence and prose', () => {
    const r = parseScoreAnswer('Here is the comparison:\n```json\n{"score": 3, "differences": ["the bridge"]}\n```\nHope that helps.')
    expect(r.score).toBe(3)
    expect(r.differences).toEqual(['the bridge'])
  })
  it('rounds a 1.0 answer and drops empty differences', () => {
    expect(parseScoreAnswer('{"score":1.0,"differences":["", "  "]}').score).toBe(1)
    expect(parseScoreAnswer('{"score":1,"differences":["", " "] }').differences).toEqual([])
  })
  it('falls back to the score when the object is not clean JSON', () => {
    const r = parseScoreAnswer('the score is "score": 2, differences were minor noise')
    expect(r.score).toBe(2)
  })
  it('keeps each difference whole in the fallback, commas and all', () => {
    const r = parseScoreAnswer('"score": 3, "differences": ["a, b", "c", "d"] and then it rambled {')
    expect(r.differences).toEqual(['a, b', 'c', 'd'])
  })
  it('throws when there is no usable 1-5 score', () => {
    expect(() => parseScoreAnswer('I cannot tell, the images are unclear')).toThrow()
    expect(() => parseScoreAnswer('{"score": 9}')).toThrow()
  })
})
