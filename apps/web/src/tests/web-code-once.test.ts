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

  it('on S3 the claim is a conditional put (If-None-Match), and a 412 or 409 means someone else won', () => {
    const src = read('packages/core/src/storage.ts')
    const fn = src.slice(src.indexOf('export async function putObjectIfAbsent'))
    expect(fn).toContain("IfNoneMatch: '*'")
    expect(fn).toContain('412')
    expect(fn).toContain('409')
    expect(fn).toContain("flag: 'wx'")
  })
})

describe('link-session records are bounded', () => {
  it('they are written with the lifecycle tag', async () => {
    expect(taggingHeader(LINK_SESSION_TAG)).toBe('lifecycle=link-session')
    const src = read('apps/web/src/lib/app-signin.ts')
    const fn = src.slice(src.indexOf('export async function markLinkSession'), src.indexOf('export const RECENT_SIGN_IN_S'))
    expect(fn).toContain('putObject(linkSessionKey(userId, session),')
    expect(fn).toContain('{ tags: LINK_SESSION_TAG })')
  })

  it('the bucket drops them after 30 days, the longest a web-code session can last', () => {
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

  it('a link session is still recorded as one, readable by hasRecentSignIn', async () => {
    await markLinkSession('user-pat', 'sess-1', Date.UTC(2026, 10, 7))
    const keys = await listKeys('users/user-pat/link-sessions/')
    expect(keys).toHaveLength(1)
    expect(await getJson(keys[0])).toEqual({ at: '2026-11-07T00:00:00.000Z' })
  })
})
