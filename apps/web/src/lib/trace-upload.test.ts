// @vitest-environment node
// Big trace files: the server takes ~4.6 MB per request, so text traces are
// gzipped in the browser and unpacked by parseTrace (.gz). Measured on the live
// site 2026-10-08: 4.5 MB reached the server, 4.8 MB got AWS's 413.
import { describe, it, expect } from 'vitest'
import { gzipSync } from 'zlib'
import { readFileSync } from 'fs'
import path from 'path'
import { parseTrace } from '@paddlesnitch/timing/parse'
import { prepareTraceUpload, uploadErrorMessage, MAX_UPLOAD_BYTES, TOO_BIG_MESSAGE, TraceTooBig } from './trace-upload'

// A long GPX: ~6 MB, more than the server would accept as it is.
function bigGpx(points = 30000) {
  const pts = Array.from({ length: points }, (_, i) =>
    `<trkpt lat="${(51.5 + i * 0.00001).toFixed(6)}" lon="-0.900000"><ele>12.0</ele><time>${new Date(Date.UTC(2026, 9, 8, 6) + i * 1000).toISOString()}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:cad>58</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>`)
  return `<?xml version="1.0"?><gpx><trk><trkseg>${pts.join('\n')}</trkseg></trk></gpx>`
}

describe('big trace uploads', () => {
  it('a big GPX is gzipped to fit, and the server reads it back point for point', async () => {
    const text = bigGpx()
    const file = new File([text], 'long.gpx')
    expect(file.size).toBeGreaterThan(MAX_UPLOAD_BYTES)
    const sent = await prepareTraceUpload(file)
    expect(sent.name).toBe('long.gpx.gz')
    expect(sent.size).toBeLessThan(MAX_UPLOAD_BYTES)
    const r = await parseTrace(sent.name, await sent.arrayBuffer())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.track).toHaveLength(30000)
  })

  it('a small file goes as it is', async () => {
    const file = new File(['x'.repeat(1000)], 'short.gpx')
    expect(await prepareTraceUpload(file)).toBe(file)
  })

  it('a FIT or zip is not gzipped, and one that can never fit says so before uploading', async () => {
    const zip = readFileSync(path.join(__dirname, '../tests/fixtures/garmin-activity-export.zip'))
    const small = new File([zip], 'garmin.zip')
    expect(await prepareTraceUpload(small)).toBe(small)
    const huge = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'huge.fit')
    await expect(prepareTraceUpload(huge)).rejects.toBeInstanceOf(TraceTooBig)
  })

  it("names the size when the server's front door refuses a file (413), instead of 'try again'", () => {
    expect(uploadErrorMessage(413, { Message: 'Request must be smaller than 6291456 bytes' }, 'Please try again.')).toBe(TOO_BIG_MESSAGE)
    expect(uploadErrorMessage(422, { error: 'No GPS points.' }, 'x')).toBe('No GPS points.')
    expect(uploadErrorMessage(500, null, 'Please try again.')).toBe('Please try again.')
  })

  it('a .gz that unpacks to something too large is refused, not unpacked into memory', async () => {
    const bomb = gzipSync(Buffer.alloc(60 * 1024 * 1024, 0x61))
    const r = await parseTrace('bomb.gpx.gz', bomb.buffer.slice(bomb.byteOffset, bomb.byteOffset + bomb.byteLength) as ArrayBuffer)
    expect(r.ok).toBe(false)
  })

  it('a .gz of something that is not a trace is an unknown format', async () => {
    const gz = gzipSync(Buffer.from('hello'))
    const r = await parseTrace('notes.txt.gz', gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer)
    expect(r).toEqual({ ok: false, reason: 'unknown_format' })
  })
})
