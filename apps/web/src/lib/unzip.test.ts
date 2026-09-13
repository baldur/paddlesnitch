// @vitest-environment node
// (fit-file-parser needs Node globals; jsdom yields an empty track)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { deflateRawSync } from 'zlib'
import { readZip } from './unzip'
import { parseTrace } from './parse'

function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

// A real Garmin Connect export: one *_ACTIVITY.fit deflated inside a zip whose
// local header uses a data descriptor (sizes zeroed). Regression fixture for #130.
const GARMIN_ZIP = toArrayBuffer(
  readFileSync(join(__dirname, '../tests/fixtures/garmin-activity-export.zip')),
)

/** Build a minimal single-file zip with sizes in the local + central records. */
function makeZip(filename: string, content: Buffer, method: 0 | 8 = 8): ArrayBuffer {
  const name = Buffer.from(filename, 'utf8')
  const body = method === 8 ? deflateRawSync(content) : content

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(0, 14) // crc (unused by reader)
  local.writeUInt32LE(body.length, 18)
  local.writeUInt32LE(content.length, 22)
  local.writeUInt16LE(name.length, 26)
  const localHeaderOffset = 0
  const localBlock = Buffer.concat([local, name, body])

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(body.length, 20)
  central.writeUInt32LE(content.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE(localHeaderOffset, 42)
  const centralBlock = Buffer.concat([central, name])

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8) // entries on disk
  eocd.writeUInt16LE(1, 10) // total entries
  eocd.writeUInt32LE(centralBlock.length, 12)
  eocd.writeUInt32LE(localBlock.length, 16)

  return toArrayBuffer(Buffer.concat([localBlock, centralBlock, eocd]))
}

describe('readZip', () => {
  it('extracts the deflated activity file from a real Garmin export', () => {
    const entries = readZip(GARMIN_ZIP)
    expect(entries).toHaveLength(1)
    expect(entries[0].filename).toBe('23438665609_ACTIVITY.fit')
    expect(entries[0].data.byteLength).toBeGreaterThan(0)
  })

  it('reads a stored (uncompressed) entry', () => {
    const zip = makeZip('activity.csv', Buffer.from('hello'), 0)
    const entries = readZip(zip)
    expect(Buffer.from(entries[0].data).toString()).toBe('hello')
  })

  it('throws on data that is not a zip', () => {
    expect(() => readZip(toArrayBuffer(Buffer.from('not a zip')))).toThrow()
  })
})

describe('parseTrace with zip', () => {
  it('unwraps a Garmin .zip and parses the inner FIT trace', async () => {
    const result = await parseTrace('23438665609_ACTIVITY.zip', GARMIN_ZIP)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.track.length).toBeGreaterThan(0)
      expect(result.track[0]).toHaveProperty('lat')
      expect(result.track[0]).toHaveProperty('lng')
    }
  })

  it('unwraps a zipped GPX file', async () => {
    const gpx =
      '<gpx><trk><trkseg>' +
      '<trkpt lat="51.5" lon="-0.9"><time>2024-06-01T10:00:00Z</time></trkpt>' +
      '<trkpt lat="51.51" lon="-0.89"><time>2024-06-01T10:01:00Z</time></trkpt>' +
      '</trkseg></trk></gpx>'
    const result = await parseTrace('ride.zip', makeZip('ride.gpx', Buffer.from(gpx)))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.track).toHaveLength(2)
  })

  it('returns unknown_format when the zip holds no supported trace file', async () => {
    const result = await parseTrace('junk.zip', makeZip('readme.txt', Buffer.from('nope')))
    expect(result).toEqual({ ok: false, reason: 'unknown_format' })
  })

  it('returns parse_error on a corrupt zip', async () => {
    const result = await parseTrace('broken.zip', toArrayBuffer(Buffer.from('PK\x03\x04garbage')))
    expect(result).toEqual({ ok: false, reason: 'parse_error' })
  })
})
