import { describe, it, expect } from 'vitest'
import { parseLookArgs } from './look-args'

const parse = (s: string) => parseLookArgs(s ? s.split(' ') : [], (p) => `/abs/${p}`)

describe('parseLookArgs', () => {
  it('defaults: look, no folders (the caller uses ~/Movies), qwen2.5vl:32b, four levels', () => {
    expect(parse('')).toEqual({ mode: 'look', folders: [], model: 'qwen2.5vl:32b', levels: 4, minutes: 0, exportPath: null, allowRemote: false })
  })
  it('folders are what is not a flag or a flag value, in either flag form', () => {
    const a = parse('--model qwen2.5vl:7b Paddling --levels=5 Fotage --minutes 60')
    expect(a.folders).toEqual(['/abs/Paddling', '/abs/Fotage'])
    expect(a).toMatchObject({ model: 'qwen2.5vl:7b', levels: 5, minutes: 60 })
  })
  it('--export takes an optional file', () => {
    expect(parse('--export').exportPath).toBeNull()
    expect(parse('--export out.geojson')).toMatchObject({ mode: 'export', exportPath: '/abs/out.geojson' })
  })
  it('refuses a misspelt flag instead of treating its value as a folder', () => {
    expect(() => parse('--level 5')).toThrow(/unknown option --level/)
  })
  it('refuses numbers that are not numbers', () => {
    expect(() => parse('--minutes abc')).toThrow(/--minutes abc/)
    expect(() => parse('--levels 2.5')).toThrow(/--levels/)
    expect(() => parse('--base 0')).toThrow(/--base/)
    expect(() => parse('--model')).toThrow(/needs a value/)
  })
  it('refuses two modes or folders with a report', () => {
    expect(() => parse('--status --export')).toThrow(/together/)
    expect(() => parse('--status Paddling')).toThrow(/doesn't take folders/)
  })
  it('--base is only set when given (the store keeps its own)', () => {
    expect(parse('').base).toBeUndefined()
    expect(parse('--base 50').base).toBe(50)
  })
})
