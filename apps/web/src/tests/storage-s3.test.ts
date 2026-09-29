// The S3 half of @paddlesnitch/core/storage, against a fake S3 client. The
// rest of the suite runs on the local filesystem, so this path had no tests,
// and two bugs sat in it:
//   - listKeys read ONE page (S3 returns at most 1,000 keys), so /devices,
//     account export and erasure silently missed data past that;
//   - getObject turned EVERY error into "not found", so a throttled or denied
//     read made read-modify-write code overwrite real data with a fresh value.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const store = new Map<string, string>()
let failGet: Error | null = null

class NoSuchKey extends Error { name = 'NoSuchKey' }

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    async send(cmd: { kind: string; input: Record<string, unknown> }) {
      const i = cmd.input
      if (cmd.kind === 'get') {
        if (failGet) throw failGet
        const v = store.get(i.Key as string)
        if (v === undefined) throw new NoSuchKey('The specified key does not exist.')
        return { Body: (async function* () { yield Buffer.from(v) })() }
      }
      if (cmd.kind === 'list') {
        // Pages of 2 so the test needs several round trips.
        const keys = [...store.keys()].filter(k => k.startsWith(i.Prefix as string)).sort()
        const start = i.ContinuationToken ? Number(i.ContinuationToken) : 0
        const page = keys.slice(start, start + 2)
        const more = start + 2 < keys.length
        return { Contents: page.map(Key => ({ Key })), IsTruncated: more, NextContinuationToken: more ? String(start + 2) : undefined }
      }
      return {}
    }
  }
  const cmd = (kind: string) => class { kind = kind; constructor(public input: Record<string, unknown>) {} }
  return {
    S3Client,
    GetObjectCommand: cmd('get'),
    ListObjectsV2Command: cmd('list'),
    PutObjectCommand: cmd('put'),
    DeleteObjectCommand: cmd('delete'),
  }
})

import { getObject, getJson, listKeys } from '@paddlesnitch/core/storage'

const env = { ...process.env }
beforeEach(() => {
  store.clear(); failGet = null
  process.env.NODE_ENV = 'production'
  process.env.USE_LOCAL_STORAGE = 'false'
  process.env.DATA_BUCKET = 'test-bucket'
})
afterEach(() => { process.env = { ...env } })

describe('S3 storage', () => {
  it('lists every key under a prefix, across pages', async () => {
    for (let i = 0; i < 5; i++) store.set(`devices/D/sessions/s${i}.json`, '{}')
    store.set('other/x.json', '{}')
    expect(await listKeys('devices/')).toHaveLength(5)
  })

  it('returns null for a key that does not exist', async () => {
    expect(await getObject('nope.json')).toBeNull()
    expect(await getJson('nope.json')).toBeNull()
  })

  it('throws on any other error instead of pretending the object is missing', async () => {
    store.set('users/u/groups.json', '["g1"]')
    failGet = Object.assign(new Error('Slow Down'), { name: 'SlowDown' })
    await expect(getObject('users/u/groups.json')).rejects.toThrow('Slow Down')
    failGet = Object.assign(new Error('Access Denied'), { name: 'AccessDenied' })
    await expect(getJson('users/u/groups.json')).rejects.toThrow('Access Denied')
  })

  it('reads an object that exists', async () => {
    store.set('a.json', '{"ok":true}')
    expect(await getJson('a.json')).toEqual({ ok: true })
  })
})
