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
// The next put fails with this HTTP status (409: a racing conditional write; 500: S3 broke).
let failPut: number | null = null
const puts: Record<string, unknown>[] = []
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { $metadata: { httpStatusCode: status } })

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
      if (cmd.kind === 'put') {
        puts.push(i)
        if (failPut) { const status = failPut; failPut = null; throw httpError(status) }
        // A conditional put (If-None-Match: *) refuses a key that exists, as S3 does.
        if (i.IfNoneMatch === '*' && store.has(i.Key as string)) throw httpError(412)
        store.set(i.Key as string, String(i.Body))
        return {}
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

import { getObject, getJson, listKeys, putObjectIfAbsent } from '@paddlesnitch/core/storage'
import { markLinkSession } from '@/lib/app-signin'

const env = { ...process.env }
beforeEach(() => {
  store.clear(); failGet = null; failPut = null; puts.length = 0
  ;(process.env as Record<string, string>).NODE_ENV = 'production'
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

describe('S3 one-use claims (#853)', () => {
  it('putObjectIfAbsent creates a key once, as a conditional put', async () => {
    expect(await putObjectIfAbsent('auth/web-codes/redeemed/a.json', '{}')).toBe(true)
    expect(await putObjectIfAbsent('auth/web-codes/redeemed/a.json', '{}')).toBe(false)
    expect(puts.map(p => p.IfNoneMatch)).toEqual(['*', '*'])
  })

  it('a racing write (409) loses, so the claim fails closed', async () => {
    failPut = 409
    expect(await putObjectIfAbsent('auth/web-codes/redeemed/b.json', '{}')).toBe(false)
  })

  it('any other S3 failure throws instead of passing as a claim', async () => {
    failPut = 500
    await expect(putObjectIfAbsent('auth/web-codes/redeemed/c.json', '{}')).rejects.toThrow('HTTP 500')
  })
})

describe('S3 link-session records (#853)', () => {
  it('markLinkSession writes its record with the lifecycle tag the bucket expires', async () => {
    await markLinkSession('user-pat', 'sess-1', Date.UTC(2026, 10, 7))
    expect(puts).toHaveLength(1)
    expect(puts[0].Key).toMatch(/^users\/user-pat\/link-sessions\/[0-9a-f]{64}\.json$/)
    expect(puts[0].Tagging).toBe('lifecycle=link-session')
    expect(JSON.parse(String(puts[0].Body))).toEqual({ at: '2026-11-07T00:00:00.000Z' })
  })
})
