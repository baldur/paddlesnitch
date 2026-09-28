// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeDataDir, cleanDataDir } from './helpers'
import { putJson, putObject, getJson } from '@/lib/storage'
import { run } from '../../scripts/backfill-device-distance'

let dataDir: string
beforeEach(async () => { dataDir = await makeDataDir() })
afterEach(async () => { await cleanDataDir(dataDir) })

// Ten minutes of a tracker sitting still: each fix wobbles ~1 m.
function stillCsv(): string {
  const t0 = Date.parse('2026-09-05T09:00:00Z')
  const rows = ['timestamp,lat,lon']
  for (let i = 0; i < 600; i++) {
    rows.push(`${new Date(t0 + i * 1000).toISOString()},${(51.46 + (i % 2 ? -0.00001 : 0.00001)).toFixed(6)},-0.930000`)
  }
  return rows.join('\n')
}
const META_KEY = 'devices/AABBCCDD/sessions/s1/session.json'

async function plant(distanceMetres: number) {
  await putJson(META_KEY, { sessionId: 's1', deviceId: 'AABBCCDD', userId: 'u', filename: 'track_1.csv', uploadedAt: 'x', points: 600, distanceMetres })
  await putObject('devices/AABBCCDD/sessions/s1/trace.csv', stillCsv())
}

describe('backfill-device-distance', () => {
  it('a dry run reports the inflated raw-sum distance but writes nothing', async () => {
    await plant(1332)
    expect(await run(false)).toEqual({ checked: 1, changed: 1 })
    expect((await getJson<{ distanceMetres: number }>(META_KEY))!.distanceMetres).toBe(1332)
  })

  it('--apply rewrites it to the movement-gated distance, and a second run changes nothing', async () => {
    await plant(1332)
    await run(true)
    const fixed = (await getJson<{ distanceMetres: number }>(META_KEY))!.distanceMetres
    expect(fixed).toBeLessThan(20)
    expect(await run(true)).toEqual({ checked: 1, changed: 0 })
  })
})
