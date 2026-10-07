// @vitest-environment node
// Derived values are computed once and never stale (docs/features/performance.md).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'
import { derived, derivedKey, eraseDerived, _clearDerivedMemory } from '@paddlesnitch/core/derived'
import { listKeys } from '@paddlesnitch/core/storage'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'derived-'))
  process.env.USE_LOCAL_STORAGE = 'true'
  process.env.DATA_DIR = dir
  _clearDerivedMemory()
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); delete process.env.DATA_DIR })

const spec = (inputs: unknown[], over = {}) => ({ name: 'thing', owner: 'u1', inputs: inputs as never[], ...over })

describe('derived values', () => {
  it('computes once, then reads, even after the warm memory is gone (a cold start)', async () => {
    const compute = vi.fn(async () => ({ n: 42 }))
    expect(await derived(spec(['a', 1]), compute)).toEqual({ n: 42 })
    expect(await derived(spec(['a', 1]), compute)).toEqual({ n: 42 })
    _clearDerivedMemory()
    expect(await derived(spec(['a', 1]), compute)).toEqual({ n: 42 })
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('recomputes when any input changes: never serves a stale value', async () => {
    const compute = vi.fn(async () => Math.random())
    const first = await derived(spec(['a', 1]), compute)
    expect(await derived(spec(['a', 2]), compute)).not.toBe(first)
    expect(await derived(spec(['b', 1]), compute)).not.toBe(first)
    expect(await derived(spec(['a', 1, null]), compute)).not.toBe(first)
    expect(compute).toHaveBeenCalledTimes(4)
  })

  it('recomputes when the code that computes it changes', async () => {
    const compute = vi.fn(async () => 1)
    await derived(spec(['a'], { code: 'v1' }), compute)
    await derived(spec(['a'], { code: 'v2' }), compute)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it("keeps an owner's values under their own prefix, and erasure removes only theirs", async () => {
    expect(derivedKey(spec(['a']))).toMatch(/^derived\/u\/u1\/thing\/[0-9a-f]{40}\.json$/)
    await derived(spec(['a']), async () => 1)
    await derived(spec(['a'], { owner: 'u2' }), async () => 2)
    await eraseDerived('u1')
    expect(await listKeys('derived/')).toEqual([expect.stringMatching(/^derived\/u\/u2\//)])
    // and u1's value is computed afresh, not served from memory
    const again = vi.fn(async () => 1)
    await derived(spec(['a']), again)
    expect(again).toHaveBeenCalledTimes(1)
  })

  it('refuses names and owners that could escape their prefix', () => {
    expect(() => derivedKey(spec(['a'], { name: '../x' }))).toThrow()
    expect(() => derivedKey(spec(['a'], { owner: 'u1/../u2' }))).toThrow()
  })

  it('still answers when it cannot store the value', async () => {
    process.env.DATA_DIR = path.join(dir, 'missing', '\u0000bad')
    expect(await derived(spec(['z']), async () => 7)).toBe(7)
  })
})
