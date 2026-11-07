// Web-code links (lib/app-signin.ts, C4) work once even under a race, and the
// link-session records they leave behind don't pile up (#853).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { makeDataDir, cleanDataDir } from './helpers'
import { createWebCode, redeemWebCode, markLinkSession, LINK_SESSION_TAG } from '@/lib/app-signin'
import { getJson, listKeys, putObjectIfAbsent, taggingHeader } from '@paddlesnitch/core/storage'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

const root = path.join(__dirname, '../../../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

describe('a web code works once', () => {
  it('two redeems of one code at the same moment give exactly one sign-in', async () => {
    for (let i = 0; i < 20; i++) {
      const code = await createWebCode('pat@example.com', 'user-pat')
      const results = await Promise.all([redeemWebCode(code), redeemWebCode(code), redeemWebCode(code)])
      expect(results.filter(Boolean)).toEqual([{ email: 'pat@example.com', userId: 'user-pat' }])
    }
  })

  it('a second redeem after the first finds nothing', async () => {
    const code = await createWebCode('pat@example.com', 'user-pat')
    expect(await redeemWebCode(code)).not.toBeNull()
    expect(await redeemWebCode(code)).toBeNull()
  })

  it('an expired code is still spent and signs nobody in', async () => {
    const code = await createWebCode('pat@example.com', 'user-pat', 0)
    expect(await redeemWebCode(code, 60_001)).toBeNull()
  })

  it('putObjectIfAbsent lets exactly one writer create a key', async () => {
    const wins = await Promise.all(Array.from({ length: 10 }, () => putObjectIfAbsent('x/claim.json', '{}')))
    expect(wins.filter(Boolean)).toHaveLength(1)
    expect(await putObjectIfAbsent('x/claim.json', '{}')).toBe(false)
  })
})

describe('link-session records are bounded', () => {
  it('the tag is sent the way S3 expects it (the put itself: storage-s3.test.ts)', () => {
    expect(taggingHeader(LINK_SESSION_TAG)).toBe('lifecycle=link-session')
  })

  it('the stack declares a rule that drops the tag after 30 days, the refresh token\'s life', () => {
    const stack = read('infra/lib/att-stack.ts')
    // A web-code session lasts as long as its refresh token can.
    expect(stack).toContain('refreshTokenValidity: cdk.Duration.days(30)')
    const at = stack.indexOf("id: 'expire-link-sessions'")
    expect(at).toBeGreaterThan(0)
    const rule = stack.slice(at, at + 300)
    const [[k, v]] = Object.entries(LINK_SESSION_TAG)
    expect(rule).toContain(`tagFilters: { ${k}: '${v}' }`)
    expect(rule).toContain('expiration: cdk.Duration.days(30)')
  })

  it('markLinkSession still writes one record per session, locally', async () => {
    await markLinkSession('user-pat', 'sess-1', Date.UTC(2026, 10, 7))
    const keys = await listKeys('users/user-pat/link-sessions/')
    expect(keys).toHaveLength(1)
    expect(await getJson(keys[0])).toEqual({ at: '2026-11-07T00:00:00.000Z' })
  })
})
