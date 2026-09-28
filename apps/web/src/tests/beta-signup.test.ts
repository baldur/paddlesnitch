// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => true) }))

import { cookies } from 'next/headers'
import { sendEmail } from '@/lib/email'
import { POST as apply } from '@/app/api/beta-signup/route'
import { DELETE as deleteAccount } from '@/app/api/account/route'
import { GET as exportData } from '@/app/api/account/export/route'
import { listKeys } from '@/lib/storage'
import { getBetaApplication } from '@/lib/beta-signups'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); vi.mocked(sendEmail).mockClear() })
afterEach(async () => { await cleanDataDir(dataDir) })

const good = {
  name: 'Ann Paddler', email: 'Ann@Example.com', sport: 'kayak', frequency: 'most-weeks',
  website: '', elapsedMs: 5000,
}
const post = (body: object) => apply(new Request('http://x/api/beta-signup', { method: 'POST', body: JSON.stringify(body) }))

describe('POST /api/beta-signup', () => {
  it('saves an application and emails a notification', async () => {
    const res = await post(good)
    expect(res.status).toBe(200)
    const saved = await getBetaApplication('ann@example.com')
    expect(saved).toMatchObject({ name: 'Ann Paddler', email: 'ann@example.com', sport: 'kayak', frequency: 'most-weeks' })
    expect(sendEmail).toHaveBeenCalledOnce()
    expect(vi.mocked(sendEmail).mock.calls[0][0].subject).toBe('New beta tester application: Ann Paddler')
  })

  it('does not put the email address in the storage key', async () => {
    await post(good)
    const keys = await listKeys('beta-signups/')
    expect(keys).toHaveLength(1)
    expect(keys[0]).not.toContain('example')
  })

  it('a second application from the same email updates the first instead of adding one', async () => {
    await post(good)
    const first = await getBetaApplication('ann@example.com')
    await post({ ...good, email: 'ann@example.com', frequency: 'few-a-month' })
    expect(await listKeys('beta-signups/')).toHaveLength(1)
    const second = await getBetaApplication('ann@example.com')
    expect(second!.frequency).toBe('few-a-month')
    expect(second!.appliedAt).toBe(first!.appliedAt)
    expect(vi.mocked(sendEmail).mock.calls[1][0].subject).toMatch(/^Updated/)
  })

  it('ignores fields the form no longer sends (no note, no dry tick) and stores only what it asks for', async () => {
    await post({ ...good, note: 'extra', keepsDry: false })
    expect(Object.keys((await getBetaApplication('ann@example.com'))!).sort())
      .toEqual(['appliedAt', 'email', 'frequency', 'name', 'sport', 'updatedAt'])
  })

  it.each([
    [{ name: '' }, /name/],
    [{ email: 'not-an-email' }, /email/],
    [{ sport: 'golf' }, /paddle or row/],
    [{ frequency: 'never' }, /how often/],
  ])('rejects %o with a plain message', async (patch, msg) => {
    const res = await post({ ...good, ...patch })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(msg)
  })

  it('drops a bot silently: success reply, nothing saved, no email', async () => {
    const res = await post({ ...good, website: 'http://spam' })
    expect(res.status).toBe(200)
    expect(await listKeys('beta-signups/')).toEqual([])
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('still succeeds when the notification email fails', async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('SES down'))
    expect((await post(good)).status).toBe(200)
    expect(await getBetaApplication('ann@example.com')).not.toBeNull()
  })
})

describe('beta applications are covered by delete and export', () => {
  function signInAs(idToken: string) {
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) => (name === 'tt_id' ? { name, value: idToken } : undefined),
    } as never)
  }

  it('export includes the application made with the account email', async () => {
    const me = await makeUser('Me')
    await post({ ...good, email: me.email })
    signInAs(me.idToken)
    const body = JSON.parse(await (await exportData()).text())
    expect(body.betaApplication).toMatchObject({ email: me.email, sport: 'kayak' })
  })

  it('deleting the account deletes the application made with its email', async () => {
    const me = await makeUser('Me')
    await post({ ...good, email: me.email })
    await post({ ...good, email: 'someone.else@example.com' })
    signInAs(me.idToken)
    await deleteAccount()
    expect(await getBetaApplication(me.email)).toBeNull()
    expect(await getBetaApplication('someone.else@example.com')).not.toBeNull()
  })
})
