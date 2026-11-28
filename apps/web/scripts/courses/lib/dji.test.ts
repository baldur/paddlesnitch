// Synthetic SRT, djmd and XMP: made by hand here, never cut from real footage.
import { describe, it, expect } from 'vitest'
import { framesFromDjmd, headingFromTrack, joinPoses, parseDjiXmp, parseDjmd, parseSrt, protoFields } from './dji'

// A made-up place in the sea, nowhere anyone lives.
const LAT = 50.1
const LNG = -2.1

const srtBlock = (i: number, t: string, extra: string) => `${i}
${t} --> ${t}
<font size="28">FrameCnt: ${i}, DiffTime: 33ms
2020-01-02 10:00:00.${String(i).padStart(3, '0')}
[iso: 100] [shutter: 1/240.0] [fnum: 1.7] [ev: 0] [color_md: default] [focal_len: 24.00] ${extra} [ct: 5000] </font>
`

describe('parseSrt', () => {
  it('reads each frame: time, clock, position, height above take-off and focal length', () => {
    const text = [
      srtBlock(1, '00:00:00,000', `[latitude: ${LAT}] [longitude: ${LNG}] [rel_alt: 65.200 abs_alt: 18.213]`),
      srtBlock(2, '00:01:02,533', `[latitude: ${LAT + 0.001}] [longitude: ${LNG}] [rel_alt: 64.900 abs_alt: 18.0]`),
    ].join('\n')
    const f = parseSrt(text)
    expect(f).toHaveLength(2)
    expect(f[0]).toEqual({ t: 0, clock: '2020-01-02 10:00:00.001', lat: LAT, lng: LNG, relAlt: 65.2, focal: 24 })
    expect(f[1].t).toBeCloseTo(62.533, 6)
    expect(f[1].relAlt).toBe(64.9)
  })

  it('drops frames without a fix (0, 0) or without a position, and copes with Windows line ends', () => {
    const text = [
      srtBlock(1, '00:00:00,000', '[latitude: 0.000000] [longitude: 0.000000] [rel_alt: 0.000 abs_alt: 0]'),
      srtBlock(2, '00:00:00,033', '[rel_alt: 1.0 abs_alt: 1]'),
      srtBlock(3, '00:00:00,066', `[latitude: ${LAT}] [longitude: ${LNG}] [rel_alt: 2.0 abs_alt: 3]`),
    ].join('\n').replace(/\n/g, '\r\n')
    expect(parseSrt(text).map((f) => f.t)).toEqual([0.066])
  })
})

// ---------- a hand-made protobuf encoder for the djmd layout ----------
const varint = (n: bigint) => {
  const out: number[] = []
  let v = BigInt.asUintN(64, n)
  do { let b = Number(v & BigInt(0x7f)); v >>= BigInt(7); if (v) b |= 0x80; out.push(b) } while (v)
  return Buffer.from(out)
}
const key = (f: number, w: number) => varint(BigInt((f << 3) | w))
const vInt = (f: number, n: number) => Buffer.concat([key(f, 0), varint(BigInt(n))])
const msg = (f: number, ...parts: Buffer[]) => { const b = Buffer.concat(parts); return Buffer.concat([key(f, 2), varint(BigInt(b.length)), b]) }
const str = (f: number, s: string) => msg(f, Buffer.from(s))
const f32 = (f: number, x: number) => { const b = Buffer.alloc(4); b.writeFloatLE(x); return Buffer.concat([key(f, 5), b]) }
const f64 = (f: number, x: number) => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return Buffer.concat([key(f, 1), b]) }

/** One frame's message as a Mini 4 Pro writes it: frame (3) → drone (3) attitude, gimbal (4) attitude, in tenths of a degree. */
const frame = (pitch: number, roll: number, yaw: number, droneYaw: number) => msg(3,
  msg(1, vInt(1, 1), vInt(2, 1000)),
  msg(2, msg(1, str(4, 'camera'), f32(5, 29.97)), msg(23, f32(1, 1.5))),
  msg(3, msg(1, vInt(1, 1)), msg(3, vInt(1, 2), vInt(2, -80), vInt(3, droneYaw)), msg(4, msg(1, f64(2, LAT), f64(3, LNG)), vInt(2, 18000)), msg(5, f32(1, 65200))),
  msg(4, msg(1, vInt(1, 2)), msg(3, ...(pitch ? [vInt(1, pitch)] : []), ...(roll ? [vInt(2, roll)] : []), vInt(3, yaw)), msg(4, f32(1, 0.5))),
)

describe('parseDjmd', () => {
  it('reads the gimbal pitch, roll and yaw (negative int32s, zeros left out) and the drone yaw', () => {
    const packets = [
      Buffer.concat([msg(1, str(1, 'header.proto')), frame(-834, 0, -1220, -1175)]), // the first packet also has a header
      frame(0, 15, 998, 1000),
    ]
    const g = parseDjmd(Buffer.concat(packets), packets.map((p) => p.length), [0, 0.0334])
    expect(g).toHaveLength(2)
    expect(g[0]).toMatchObject({ t: 0, pitch: -83.4, roll: 0 })
    expect(g[0].yaw).toBeCloseTo(238, 6) // -122.0° as a compass bearing
    expect(g[0].droneYaw).toBeCloseTo(242.5, 6)
    expect(g[1]).toMatchObject({ t: 0.0334, pitch: 0, roll: 1.5 })
    expect(g[1].yaw).toBeCloseTo(99.8, 6)
  })

  it('skips a packet that is not a frame with a gimbal block, and one that is garbage', () => {
    const packets = [msg(2, str(3, 'video')), Buffer.from([0xff, 0xff, 0xff]), frame(-100, 0, 0, 0)]
    const g = parseDjmd(Buffer.concat(packets), packets.map((p) => p.length), [0, 1, 2])
    expect(g.map((x) => x.t)).toEqual([2])
  })

  it("also reads the drone's position, height above take-off (mm) and zoom, which stand in for a missing SRT", () => {
    const p = frame(-450, 0, 900, 900)
    const g = parseDjmd(p, [p.length], [1.5])
    expect(g[0]).toMatchObject({ lat: LAT, lng: LNG, zoom: 1.5 })
    expect(g[0].relAlt).toBeCloseTo(65.2, 3)
    expect(framesFromDjmd(g)).toEqual([{ t: 1.5, clock: null, lat: LAT, lng: LNG, relAlt: g[0].relAlt, focal: 36 }])
  })

  it('protoFields refuses bytes that run off the end', () => {
    expect(() => protoFields(Buffer.from([0x0a, 0x05, 0x01]))).toThrow()
  })
})

describe('parseDjiXmp', () => {
  const xmp = (over = '') => `<x:xmpmeta><rdf:Description xmp:CreateDate="2020-01-02T10:00:00+00:00"
    drone-dji:GpsLatitude="+${LAT}" drone-dji:GpsLongitude="${LNG}" drone-dji:RelativeAltitude="+118.300"
    drone-dji:GimbalRollDegree="+0.00" drone-dji:GimbalYawDegree="-122.00" drone-dji:GimbalPitchDegree="-19.10" ${over}/></x:xmpmeta>`

  it("reads a photo's position, height and gimbal angles", () => {
    expect(parseDjiXmp(xmp())).toEqual({ lat: LAT, lng: LNG, relAlt: 118.3, pitch: -19.1, roll: 0, yaw: 238, clock: '2020-01-02T10:00:00+00:00' })
  })

  it('is null without gimbal angles or without a position', () => {
    expect(parseDjiXmp('<x:xmpmeta drone-dji:GpsLatitude="1" drone-dji:GpsLongitude="2"/>')).toBeNull()
    expect(parseDjiXmp(xmp().replace(/drone-dji:Gps\w+="[^"]*"/g, ''))).toBeNull()
  })
})

describe('joinPoses', () => {
  it("gives every SRT frame the gimbal's angles at the nearest djmd time", () => {
    const frames = [0, 0.4, 1].map((t) => ({ t, clock: null, lat: LAT, lng: LNG, relAlt: 50, focal: null }))
    const g = [{ t: 0.02, pitch: -10, roll: 0, yaw: 90, droneYaw: null }, { t: 0.98, pitch: -20, roll: 0, yaw: 180, droneYaw: null }]
    const p = joinPoses(frames, g)
    expect(p.map((x) => [x.pitch, x.yaw, x.focal, x.source])).toEqual([[-10, 90, 24, 'djmd'], [-10, 90, 24, 'djmd'], [-20, 180, 24, 'djmd']])
  })
  it('is empty without any gimbal angles (so the caller falls back to the track)', () => {
    expect(joinPoses([{ t: 0, clock: null, lat: LAT, lng: LNG, relAlt: 1, focal: 24 }], [])).toEqual([])
  })
})

describe('headingFromTrack', () => {
  it('faces the way the drone moved, and frames before it moved face its first way', () => {
    // Hovering for 5 s, then 20 m/s due east.
    const frames = Array.from({ length: 11 }, (_, i) => ({ t: i, clock: null, relAlt: 30, focal: 24, lat: LAT, lng: LNG + (i <= 5 ? 0 : ((i - 5) * 20) / (111_320 * Math.cos((LAT * Math.PI) / 180))) }))
    const p = headingFromTrack(frames)
    expect(p).toHaveLength(11)
    for (const x of p) { expect(x.yaw).toBeCloseTo(90, 0); expect(x.source).toBe('track') }
  })
  it('is empty when the drone never moved: there is no way to tell where it looked', () => {
    expect(headingFromTrack([0, 1, 2].map((t) => ({ t, clock: null, lat: LAT, lng: LNG, relAlt: 30, focal: 24 })))).toEqual([])
  })
})
