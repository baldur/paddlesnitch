// GPS from a GoPro video's telemetry track (GPMF, the "GoPro MET" data stream
// in an .mp4 or .360 file). Pure: takes the raw stream bytes, which
// `ffmpeg -i in.360 -map 0:m:handler_name:"GoPro MET" -c copy -f data out.bin`
// extracts in a second or two even from a 10 GB file.
//
// GPMF is key-length-value: a 4-character key, a type character, the size of one
// sample, and a repeat count, then the data padded to 4 bytes. Type 0 means the
// data is more KLV (nested). The stream is a run of DEVC payloads, one per
// ~1 s of video, each holding a STRM per sensor.
//
// Two GPS layouts:
//  - GPS9 (HERO11+, MAX 2): each row carries its own time, DOP and fix.
//  - GPS5 (older HERO, MAX): rows are lat/lon/alt/speeds; the payload's GPSU
//    (UTC "yymmddhhmmss.sss"), GPSF (fix) and GPSP (DOP x100) cover the payload,
//    and its rows are spread evenly across it.
//
// `at` places each fix on the video's clock in payload units: payload k covers
// [k, k+1), so `at * duration / payloads` is seconds into the file.

export type GpmfFix = {
  lat: number
  lng: number
  alt: number           // metres
  speed: number         // 2D ground speed, m/s
  timestamp: Date
  dop: number           // dilution of precision; under ~2 is good, over 5 is poor
  fix: number           // 0 none, 2 2D, 3 3D
  at: number            // payload units (see above)
}

export type GpmfGps = { payloads: number; fixes: GpmfFix[] }

type Klv = { key: string; type: number; size: number; repeat: number; body: DataView }

function* klvs(view: DataView): Generator<Klv> {
  let i = 0
  while (i + 8 <= view.byteLength) {
    const key = String.fromCharCode(view.getUint8(i), view.getUint8(i + 1), view.getUint8(i + 2), view.getUint8(i + 3))
    const type = view.getUint8(i + 4)
    const size = view.getUint8(i + 5)
    const repeat = view.getUint16(i + 6)
    const n = size * repeat
    if (i + 8 + n > view.byteLength) return
    yield { key, type, size, repeat, body: new DataView(view.buffer, view.byteOffset + i + 8, n) }
    i += 8 + ((n + 3) & ~3)
  }
}

// The numbers in a SCAL (or any simple-typed KLV), whatever their width.
function numbers(k: Klv): number[] {
  const out: number[] = []
  const t = String.fromCharCode(k.type)
  const width = { b: 1, B: 1, s: 2, S: 2, l: 4, L: 4, f: 4 }[t]
  if (!width) return out
  for (let o = 0; o + width <= k.body.byteLength; o += width) {
    const v = t === 'b' ? k.body.getInt8(o) : t === 'B' ? k.body.getUint8(o)
      : t === 's' ? k.body.getInt16(o) : t === 'S' ? k.body.getUint16(o)
      : t === 'l' ? k.body.getInt32(o) : t === 'L' ? k.body.getUint32(o) : k.body.getFloat32(o)
    out.push(v)
  }
  return out
}

function text(k: Klv): string {
  let s = ''
  for (let o = 0; o < k.body.byteLength; o++) s += String.fromCharCode(k.body.getUint8(o))
  return s.replace(/\0+$/, '')
}

// "yymmddhhmmss.sss" in UTC.
function gpsu(s: string): Date {
  const [y, mo, d, h, mi] = [0, 2, 4, 6, 8].map((o) => Number(s.slice(o, o + 2)))
  return new Date(Date.UTC(2000 + y, mo - 1, d, h, mi) + Number(s.slice(10)) * 1000)
}

const GPS_EPOCH = Date.UTC(2000, 0, 1)

export function parseGpmfGps(data: ArrayBuffer | Uint8Array): GpmfGps {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const fixes: GpmfFix[] = []
  let payloads = 0

  for (const devc of klvs(view)) {
    if (devc.key !== 'DEVC') continue
    const payload = payloads++
    for (const strm of klvs(devc.body)) {
      if (strm.key !== 'STRM' || strm.type !== 0) continue
      let scal: number[] = [1]
      let utc: Date | undefined
      let fix = 0
      let dop = 99
      let gps5: Klv | undefined
      for (const k of klvs(strm.body)) {
        if (k.key === 'SCAL') scal = numbers(k)
        else if (k.key === 'GPSU') utc = gpsu(text(k))
        else if (k.key === 'GPSF') fix = numbers(k)[0] ?? 0
        else if (k.key === 'GPSP') dop = (numbers(k)[0] ?? 9999) / 100
        else if (k.key === 'GPS9') {
          const sc = (j: number) => scal[j] ?? scal[0] ?? 1
          for (let r = 0; r < k.repeat; r++) {
            const o = r * k.size
            const v = (j: number) => k.body.getInt32(o + j * 4) / sc(j)
            fixes.push({
              lat: v(0), lng: v(1), alt: v(2), speed: v(3),
              timestamp: new Date(GPS_EPOCH + k.body.getInt32(o + 20) * 86_400_000 + (k.body.getInt32(o + 24) / sc(6)) * 1000),
              dop: k.body.getUint16(o + 28) / sc(7),
              fix: k.body.getUint16(o + 30) / sc(8),
              at: payload + r / k.repeat,
            })
          }
        } else if (k.key === 'GPS5') gps5 = k
      }
      // GPS5's time, fix and DOP can sit either side of it in the stream. Its rows
      // are 1/18 s apart; spreading them over the payload is all a frame needs.
      if (gps5 && utc) {
        const k = gps5
        for (let r = 0; r < k.repeat; r++) {
          const o = r * k.size
          const v = (j: number) => k.body.getInt32(o + j * 4) / (scal[j] ?? scal[0] ?? 1)
          fixes.push({
            lat: v(0), lng: v(1), alt: v(2), speed: v(3),
            timestamp: new Date(utc.getTime() + (r / k.repeat) * 1000),
            dop, fix, at: payload + r / k.repeat,
          })
        }
      }
    }
  }
  return { payloads, fixes }
}
