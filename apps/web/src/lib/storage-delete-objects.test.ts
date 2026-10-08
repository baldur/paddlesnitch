// @vitest-environment node
// The S3 side of deleteObjects (local dev just unlinks files): batches of at
// most 1,000 keys, each key once, and an error when S3 says it couldn't delete
// one, so erasure never reports data gone that isn't.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const sent = vi.hoisted(() => ({ batches: [] as string[][], errors: null as null | { Key: string; Code: string }[] }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { async send(cmd: { input: { Delete: { Objects: { Key: string }[] } } }) {
    sent.batches.push(cmd.input.Delete.Objects.map(o => o.Key))
    return { Errors: sent.errors ?? undefined }
  } },
  DeleteObjectsCommand: class { constructor(public input: unknown) {} },
}))

import { deleteObjects } from '@paddlesnitch/core/storage'

beforeEach(() => {
  sent.batches = []; sent.errors = null
  vi.stubEnv('USE_LOCAL_STORAGE', '')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('DATA_BUCKET', 'bucket')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('deleteObjects against S3', () => {
  it('deletes 2,500 keys in three calls, each key once', async () => {
    const keys = Array.from({ length: 2500 }, (_, i) => `k${i}`)
    await deleteObjects([...keys, 'k1', 'k2'])
    expect(sent.batches.map(b => b.length)).toEqual([1000, 1000, 500])
    expect(new Set(sent.batches.flat()).size).toBe(2500)
  })

  it('makes no call for nothing', async () => {
    await deleteObjects([])
    expect(sent.batches).toEqual([])
  })

  it('fails when S3 could not delete a key', async () => {
    sent.errors = [{ Key: 'k1', Code: 'AccessDenied' }]
    await expect(deleteObjects(['k1'])).rejects.toThrow(/k1: AccessDenied/)
  })
})
