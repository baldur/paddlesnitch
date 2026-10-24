// @vitest-environment node
// Beta first, then everyone. A merge promotes a new build to the BETA channel;
// only trackers on the beta list (firmware/beta-devices.json, which only the
// owner's AWS login can write) are offered it. Once it has run on a beta
// tracker, promoting that same version to STABLE -- the flip -- offers it to
// every tracker. Same bytes both times: what the beta tracker ran is exactly
// what everyone gets.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'
import { provedPoll } from './device-proof'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as claim } from '@/app/api/devices/claim/route'
import { POST as token } from '@/app/api/devices/token/route'
import { POST as link } from '@/app/api/account/devices/link/route'
import { GET as getFirmware } from '@/app/api/devices/firmware/route'
import { POST as health } from '@/app/api/devices/health/route'
import { GET as listDevices } from '@/app/api/account/devices/route'
import { publishFirmware, promoteFirmware, versionForDevice, __clearChannelCache } from '@/lib/firmware'
import { putJson } from '@/lib/storage'
import { cookies } from 'next/headers'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir(); __clearChannelCache() })
afterEach(async () => { await cleanDataDir(dataDir); __clearChannelCache(); vi.restoreAllMocks() })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === 'tt_id' && idToken ? { name, value: idToken } : undefined),
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}
const jreq = (body: unknown) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const BETA = '435AC17C'
const OTHER = '435C09C8'
const IMAGE = Buffer.from('an image')

async function collectToken(deviceId: string, claimSecret: string) {
  return (await (await token(jreq(await provedPoll(deviceId, claimSecret)))).json()).deviceToken as string
}
async function boundToken(u: { idToken: string }, deviceId: string) {
  const { claimCode, claimSecret } = await (await claim(jreq({ deviceId, model: 'm', firmware: '0.18.2' }))).json()
  mockAuth(u.idToken)
  await link(jreq({ claimCode }))
  return collectToken(deviceId, claimSecret)
}
const setBeta = (ids: string[]) => putJson('firmware/beta-devices.json', { deviceIds: ids })
async function release(version: string, channel: 'beta' | 'stable') {
  await publishFirmware(version, IMAGE, { notes: 'n' })
  await promoteFirmware(channel, version)
  __clearChannelCache()
}
const healthPing = (t: string) => new Request('http://x', {
  method: 'POST', body: JSON.stringify({ kind: 'heartbeat', uptimeS: 1 }),
  headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
})

describe('a merged build reaches beta trackers only', () => {
  it('a beta tracker is told about the beta version; everyone else stays on stable', async () => {
    await release('0.18.2', 'stable')
    await release('0.19.0', 'beta')
    await setBeta([BETA])
    const u = await makeUser('Owner')
    const tb = await boundToken(u, BETA)
    const to = await boundToken(u, OTHER)

    expect((await health(healthPing(tb))).headers.get('X-PS-Firmware')).toBe('0.19.0')
    expect((await health(healthPing(to))).headers.get('X-PS-Firmware')).toBe('0.18.2')

    const offer = await getFirmware(new Request('http://localhost/api/devices/firmware?current=0.18.2', { headers: { authorization: `Bearer ${tb}` } }))
    expect(offer.status).toBe(200)
    expect((await offer.json()).version).toBe('0.19.0')
    const none = await getFirmware(new Request('http://localhost/api/devices/firmware?current=0.18.2', { headers: { authorization: `Bearer ${to}` } }))
    expect(none.status).toBe(304)
  })

  it('the flip: promoting the same version to stable offers it to everyone', async () => {
    await release('0.18.2', 'stable')
    await release('0.19.0', 'beta')
    await setBeta([BETA])
    expect((await versionForDevice(OTHER)).version).toBe('0.18.2')
    await promoteFirmware('stable', '0.19.0'); __clearChannelCache()
    expect((await versionForDevice(OTHER)).version).toBe('0.19.0')
    expect((await versionForDevice(BETA)).version).toBe('0.19.0')
  })

  it('a beta tracker is never sent BACK to an older beta when stable has moved past it', async () => {
    await release('0.19.0', 'beta')
    await release('0.19.1', 'stable')   // flipped a later build by hand
    await setBeta([BETA])
    expect(await versionForDevice(BETA)).toEqual({ version: '0.19.1', channel: 'stable' })
  })

  it('with no beta build yet, a beta tracker simply follows stable', async () => {
    await release('0.18.2', 'stable')
    await setBeta([BETA])
    expect(await versionForDevice(BETA)).toEqual({ version: '0.18.2', channel: 'stable' })
  })

  it('a malformed beta list makes nobody beta, rather than breaking every tracker', async () => {
    await release('0.18.2', 'stable')
    await release('0.19.0', 'beta')
    await putJson('firmware/beta-devices.json', { deviceIds: 'not-a-list' })
    expect((await versionForDevice(BETA)).version).toBe('0.18.2')
  })

  it("the owner's device list says which trackers are beta and what each should run", async () => {
    await release('0.18.2', 'stable')
    await release('0.19.0', 'beta')
    await setBeta([BETA])
    const u = await makeUser('Owner')
    await boundToken(u, BETA)
    await boundToken(u, OTHER)
    mockAuth(u.idToken)
    const body = await (await listDevices(new Request("http://x/api/account/devices"))).json()
    const b = body.devices.find((d: { deviceId: string }) => d.deviceId === BETA)
    const o = body.devices.find((d: { deviceId: string }) => d.deviceId === OTHER)
    expect(b).toMatchObject({ beta: true, targetVersion: '0.19.0' })
    expect(o).toMatchObject({ targetVersion: '0.18.2' })
    expect(o.beta).toBeFalsy()
  })
})
