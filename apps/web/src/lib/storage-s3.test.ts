// @vitest-environment node
// The S3 side of storage helpers that local dev does differently.
// deleteObjects: batches of at most 1,000 keys, each key once, and an error
// when S3 says it couldn't delete one, so erasure never reports data gone that
// isn't. listPrefixes: folder names via the delimiter, across pages.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const sent = vi.hoisted(() => ({ batches: [] as string[][], errors: null as null | { Key: string; Code: string }[], lists: [] as Record<string, unknown>[] }))
vi.mock('@aws-sdk/client-s3', () => {
  class DeleteObjectsCommand { constructor(public input: { Delete: { Objects: { Key: string }[] } }) {} }
  class ListObjectsV2Command { constructor(public input: Record<string, unknown>) {} }
  return {
    DeleteObjectsCommand, ListObjectsV2Command,
    S3Client: class { async send(cmd: DeleteObjectsCommand | ListObjectsV2Command) {
      if (cmd instanceof ListObjectsV2Command) {
        sent.lists.push(cmd.input)
        // Two pages of folders under trials/.
        return cmd.input.ContinuationToken
          ? { CommonPrefixes: [{ Prefix: 'trials/t3/' }], IsTruncated: false }
          : { CommonPrefixes: [{ Prefix: 'trials/t2/' }, { Prefix: 'trials/t1/' }], IsTruncated: true, NextContinuationToken: 'next' }
      }
      sent.batches.push(cmd.input.Delete.Objects.map(o => o.Key))
      return { Errors: sent.errors ?? undefined }
    } },
  }
})

import { deleteObjects, listPrefixes } from '@paddlesnitch/core/storage'

beforeEach(() => {
  sent.batches = []; sent.errors = null; sent.lists = []
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

describe('listPrefixes against S3', () => {
  it('names the folders under a prefix, across pages, using the delimiter', async () => {
    expect(await listPrefixes('trials/')).toEqual(['t1', 't2', 't3'])
    expect(sent.lists).toHaveLength(2)
    expect(sent.lists.every(l => l.Delimiter === '/' && l.Prefix === 'trials/')).toBe(true)
  })
})
