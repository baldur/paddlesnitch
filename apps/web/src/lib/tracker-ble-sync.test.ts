import { describe, it, expect } from 'vitest'
import { deflateSync } from 'zlib'
import { syncOverBluetooth, SYNC_WAIT, type SyncIo, type PendingRecording } from './tracker-ble'

SYNC_WAIT.delayMs = 0

/** A tracker on the other end of SYNC + DATA, behaving like the firmware:
 *  64 KB pieces, zlib when that helps, pages of [u32 offset][<=500 bytes],
 *  and "marked" only for the right receipt. */
function fakeTracker(files: Record<string, string>, opts: { badReceiptFor?: string } = {}) {
  const PIECE = 64 * 1024
  let state = 'idle', data = new Uint8Array(0), cursor = 0, part = 0, parts = 0, compressed = false
  const marked: string[] = []
  const uploadName = (n: string) => n.replace(/_i10\.csv$/, '_imu.csv')
  const io: SyncIo = {
    async command(b: Record<string, unknown>) {
      cursor = 0
      if (b.op === 'list') {
        const names = Object.keys(files).sort((a, b) => Number(a.includes('_i10')) - Number(b.includes('_i10')))
        data = new TextEncoder().encode(JSON.stringify(names.map(n => ({ n, u: uploadName(n), s: files[n].length }))))
        state = 'ready'; compressed = false; parts = 0
      } else if (b.op === 'piece') {
        const raw = Buffer.from(files[b.name as string])
        parts = Math.max(1, Math.ceil(raw.length / PIECE)); part = b.part as number
        const slice = raw.subarray((part - 1) * PIECE, part * PIECE)
        const z = deflateSync(slice)
        compressed = z.length < slice.length
        data = new Uint8Array(compressed ? z : slice)
        state = 'ready'
      } else if (b.op === 'done') {
        const ok = b.receipt === `receipt-for-${uploadName(b.name as string)}` && b.name !== opts.badReceiptFor
        if (ok) marked.push(b.name as string)
        state = ok ? 'marked' : 'bad_receipt'
      }
    },
    async status() { return { state: state as never, len: data.length, part, parts, compressed } },
    async readPage() {
      const n = Math.min(500, data.length - cursor)
      const p = new Uint8Array(4 + n)
      new DataView(p.buffer).setUint32(0, cursor, true)
      p.set(data.subarray(cursor, cursor + n), 4)
      cursor += n
      return new DataView(p.buffer)
    },
    async seek(o: number) { cursor = o },
    upload: async () => ({ status: 500, body: {} }),
  }
  return { io, marked }
}

/** The server side: assembles parts, answers 202 until the last, then 201 + receipt. */
function fakeServer(io: SyncIo, received: Record<string, Buffer[]>) {
  io.upload = async (r: PendingRecording, part: number, parts: number, bytes: Uint8Array, compressed: boolean) => {
    const { inflateSync } = await import('zlib')
    ;(received[r.upload] ??= [])[part - 1] = compressed ? inflateSync(Buffer.from(bytes)) : Buffer.from(bytes)
    return part < parts ? { status: 202, body: {} } : { status: 201, body: { receipt: `receipt-for-${r.upload}` } }
  }
}

const big = (rows: number) => Array.from({ length: rows }, (_, i) => `${i},0.0${i % 10},0.02,1.00,${i % 50}.5,1.2,0.3`).join('\n')

describe('syncing recordings over Bluetooth', () => {
  it('sends every waiting recording byte-exact, track before its motion file, and marks each with its receipt', async () => {
    const files = { 'track_a.csv': 'timestamp,lat,lon\n' + big(2000), 'track_a_i10.csv': 'ms,ax_g\n' + big(9000) }
    const { io, marked } = fakeTracker(files)
    const received: Record<string, Buffer[]> = {}
    fakeServer(io, received)
    const order: string[] = []
    const r = await syncOverBluetooth(io, p => { if (p.part === 1) order.push(p.name) })
    expect(r).toEqual({ sent: 2, failed: [] })
    expect(order).toEqual(['track_a.csv', 'track_a_i10.csv'])
    expect(Buffer.concat(received['track_a.csv']).toString()).toBe(files['track_a.csv'])
    // The motion file goes up under the name the server knows it by.
    expect(Buffer.concat(received['track_a_imu.csv']).toString()).toBe(files['track_a_i10.csv'])
    expect(received['track_a_imu.csv'].length).toBeGreaterThan(1)   // several 64 KB pieces
    expect(marked).toEqual(['track_a.csv', 'track_a_i10.csv'])
  })

  it('accepts "already uploaded" with its receipt, so a lost answer gets the recording marked', async () => {
    const { io, marked } = fakeTracker({ 'track_b.csv': 'x\n1' })
    io.upload = async r => ({ status: 409, body: { error: 'already_uploaded', receipt: `receipt-for-${r.upload}` } })
    expect((await syncOverBluetooth(io)).sent).toBe(1)
    expect(marked).toEqual(['track_b.csv'])
  })

  it("leaves a recording waiting when the tracker doesn't accept the receipt", async () => {
    const { io, marked } = fakeTracker({ 'track_c.csv': 'x\n1' }, { badReceiptFor: 'track_c.csv' })
    fakeServer(io, {})
    const r = await syncOverBluetooth(io)
    expect(r.sent).toBe(0)
    expect(r.failed).toEqual([{ name: 'track_c.csv', reason: 'receipt' }])
    expect(marked).toEqual([])
  })

  it('carries on with the next recording when one cannot be used (422)', async () => {
    const { io, marked } = fakeTracker({ 'track_d.csv': 'x\n1', 'track_e.csv': 'y\n2' })
    io.upload = async r => r.name === 'track_d.csv'
      ? { status: 422, body: { error: 'no_points' } }
      : { status: 201, body: { receipt: `receipt-for-${r.upload}` } }
    const r = await syncOverBluetooth(io)
    expect(r.sent).toBe(1)
    expect(r.failed).toEqual([{ name: 'track_d.csv', reason: 'unusable' }])
    expect(marked).toEqual(['track_e.csv'])
  })

  it('stops with a clear reason while the tracker is recording', async () => {
    const { io } = fakeTracker({ 'track_f.csv': 'x' })
    io.status = async () => ({ state: 'busy', len: 0, part: 0, parts: 0, compressed: false })
    await expect(syncOverBluetooth(io)).rejects.toThrow('recording')
  })
})
