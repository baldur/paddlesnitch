// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { makeDataDir, cleanDataDir, makeUser } from './helpers'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

import { POST as claim } from '@/app/api/devices/claim/route'
import { POST as token } from '@/app/api/devices/token/route'
import { POST as link } from '@/app/api/account/devices/link/route'
import { POST as health } from '@/app/api/devices/health/route'
import { GET as listDevices } from '@/app/api/account/devices/route'
import { listKeys, getJson } from '@/lib/storage'
import { eraseUserDevices, exportUserDevices } from '@/lib/devices'
import { cookies } from 'next/headers'

// Tracker health (docs/features/release-testing.md, "crash alerts"): once per
// start the tracker reports why it restarted -- with the crash summary the chip
// saved, if it crashed -- and every hour while on WiFi a heartbeat. A crash
// shows up on the server without anyone reporting it, counted per version.

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir); vi.restoreAllMocks() })

function mockAuth(idToken: string | null) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === 'tt_id' && idToken ? { name, value: idToken } : undefined),
  } as ReturnType<typeof cookies> extends Promise<infer T> ? T : never)
}
const jreq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })
const DEVICE = '435AC17C'

async function linkedTracker() {
  const u = await makeUser('Health Owner')
  const { claimCode, claimSecret } = await (await claim(jreq({ deviceId: DEVICE, model: 'lilygo-tbeam-s3-supreme', firmware: '0.18.0' }))).json()
  mockAuth(u.idToken)
  await link(jreq({ claimCode }))
  const deviceToken = (await (await token(jreq({ deviceId: DEVICE, claimSecret }))).json()).deviceToken as string
  return { u, deviceToken }
}
const report = (dt: string, body: unknown) =>
  health(jreq(body, { authorization: `Bearer ${dt}`, 'x-device-firmware': '0.18.0', 'x-device-model': 'lilygo-tbeam-s3-supreme' }))

const CRASH = {
  kind: 'boot', resetReason: 'PANIC', uptimeS: 3, heapMin: 180000, psramFree: 7900000, battMv: 4100, onUsb: true,
  crash: { task: 'uplink', pc: '0x42011ebb', bt: ['0x4037d399', '0x42011ebb', '0x42012f9f'], corrupted: false, elf: '1a2b3c4d5e6f7a8b' },
}

describe('tracker health reports', () => {
  it('stores a start-up report with its crash, and counts the crash per version', async () => {
    const { deviceToken } = await linkedTracker()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await report(deviceToken, CRASH)
    expect(res.status).toBe(200)
    const latest = await getJson<{ kind: string; resetReason: string; crash: { task: string } }>(`devices/${DEVICE}/health/latest.json`)
    expect(latest?.resetReason).toBe('PANIC')
    expect(latest?.crash.task).toBe('uplink')
    expect((await listKeys(`devices/${DEVICE}/crashes/`)).length).toBe(1)
    const emf = log.mock.calls.map(c => String(c[0])).find(l => l.includes('"DeviceCrash"'))!
    expect(JSON.parse(emf)).toMatchObject({ Version: '0.18.0', Model: 'lilygo-tbeam-s3-supreme', deviceId: DEVICE, task: 'uplink' })
  })

  it('a heartbeat updates the latest report without counting a crash', async () => {
    const { deviceToken } = await linkedTracker()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect((await report(deviceToken, { kind: 'heartbeat', uptimeS: 3600, heapMin: 170000, stackHeadroom: 7800 })).status).toBe(200)
    expect((await getJson<{ kind: string }>(`devices/${DEVICE}/health/latest.json`))?.kind).toBe('heartbeat')
    expect((await listKeys(`devices/${DEVICE}/crashes/`)).length).toBe(0)
    expect(log.mock.calls.some(c => String(c[0]).includes('"DeviceCrash"'))).toBe(false)
  })

  it('keeps reports small and clean: unknown kinds refused, long backtraces trimmed, odd text dropped', async () => {
    const { deviceToken } = await linkedTracker()
    expect((await report(deviceToken, { kind: 'surprise' })).status).toBe(400)
    await report(deviceToken, { ...CRASH, crash: { ...CRASH.crash, task: '<script>x</script>', bt: Array.from({ length: 40 }, (_, i) => `0x4200${String(i).padStart(4, '0')}`) } })
    const latest = await getJson<{ crash: { task: string; bt: string[] } }>(`devices/${DEVICE}/health/latest.json`)
    expect(latest?.crash.bt.length).toBe(16)
    expect(latest?.crash.task).not.toContain('<')
  })

  it('keeps the last 20 crashes, not every one for ever', async () => {
    const { deviceToken } = await linkedTracker()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    for (let i = 0; i < 23; i++) await report(deviceToken, CRASH)
    expect((await listKeys(`devices/${DEVICE}/crashes/`)).length).toBe(20)
  })

  it('needs the tracker token', async () => {
    expect((await health(jreq(CRASH))).status).toBe(401)
  })

  it("shows the owner the tracker's last restart", async () => {
    const { u, deviceToken } = await linkedTracker()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await report(deviceToken, CRASH)
    mockAuth(u.idToken)
    const { devices } = await (await listDevices()).json()
    expect(devices[0].health).toMatchObject({ kind: 'boot', resetReason: 'PANIC', crashTask: 'uplink' })
    // A later heartbeat replaces the latest report, but the crash stays visible.
    mockAuth(null)
    await report(deviceToken, { kind: 'heartbeat', uptimeS: 3600 })
    mockAuth(u.idToken)
    const again = (await (await listDevices()).json()).devices[0]
    expect(again.health.kind).toBe('heartbeat')
    expect(again.lastCrash).toMatchObject({ task: 'uplink' })
  })

  it('goes with the account: exported, and erased with it', async () => {
    const { u, deviceToken } = await linkedTracker()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await report(deviceToken, CRASH)
    expect((await exportUserDevices(u.id)).trackers[0]).toMatchObject({ health: { resetReason: 'PANIC' } })
    await eraseUserDevices(u.id)
    expect(await listKeys(`devices/${DEVICE}/health/`)).toEqual([])
    expect(await listKeys(`devices/${DEVICE}/crashes/`)).toEqual([])
  })
})
