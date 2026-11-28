// Reading where a DJI drone was and where its camera pointed, from the files it
// writes beside each clip and photo. Pure; tested in dji.test.ts.
//
// - `.SRT`: a subtitle per video frame with the time, the camera settings,
//   latitude, longitude, height above the take-off point (`rel_alt`) and the
//   35 mm-equivalent focal length. No camera angles.
// - The MP4's (or LRF's) "DJI meta" data track (`djmd`): one protobuf message per
//   frame. Its gimbal block holds the camera's pitch, roll and yaw (compass) in
//   tenths of a degree. Field numbers were read off a Mini 4 Pro's clips
//   (`dvtm_Mini4_Pro.proto` names itself in the first message) and checked
//   against the quaternion beside them and the photos' XMP.
// - A photo's XMP (`drone-dji:` attributes): position, height and the gimbal's
//   angles, in degrees.
//
// Without a djmd track, `headingFromTrack` gives the direction the drone moved:
// a guess at where the camera faced, flagged as such.

export type SrtFrame = { t: number; clock: string | null; lat: number; lng: number; relAlt: number; focal: number | null }

const num = (re: RegExp, s: string): number | null => {
  const m = re.exec(s)
  return m ? Number(m[1]) : null
}

/** "00:01:02,500" → 62.5 */
function srtTime(s: string): number {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 10 ** m[4].length : NaN
}

/** Every frame of a DJI SRT that has a position. A frame at 0, 0 (no fix yet) is dropped. */
export function parseSrt(text: string): SrtFrame[] {
  const out: SrtFrame[] = []
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const timing = /^(\S+)\s*-->/m.exec(block)
    if (!timing) continue
    const lat = num(/latitude\s*:\s*(-?[\d.]+)/i, block)
    const lng = num(/longitude\s*:\s*(-?[\d.]+)/i, block)
    if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue
    out.push({
      t: srtTime(timing[1]),
      clock: /(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?)/.exec(block)?.[1] ?? null,
      lat, lng,
      relAlt: num(/rel_alt\s*:\s*(-?[\d.]+)/i, block) ?? 0,
      focal: num(/focal_len\s*:\s*([\d.]+)/i, block),
    })
  }
  return out
}

// ---------- protobuf, just enough to walk djmd ----------

type Field = { f: number; w: number; v: bigint | Buffer | number }

function varint(b: Buffer, o: number): [bigint, number] {
  let r = BigInt(0)
  let s = BigInt(0)
  for (;;) {
    if (o >= b.length) throw new Error('varint runs off the end')
    const c = b[o++]
    r |= BigInt(c & 0x7f) << s
    s += BigInt(7)
    if (!(c & 0x80)) return [r, o]
    if (s > BigInt(70)) throw new Error('varint too long')
  }
}

/** The fields of one protobuf message; throws on anything that isn't one. */
export function protoFields(b: Buffer): Field[] {
  const out: Field[] = []
  let o = 0
  while (o < b.length) {
    let key: bigint
    ;[key, o] = varint(b, o)
    const f = Number(key >> BigInt(3))
    const w = Number(key & BigInt(7))
    if (f === 0) throw new Error('field 0')
    if (w === 0) { let v: bigint; [v, o] = varint(b, o); out.push({ f, w, v }) }
    else if (w === 1) { if (o + 8 > b.length) throw new Error('short'); out.push({ f, w, v: b.readDoubleLE(o) }); o += 8 }
    else if (w === 5) { if (o + 4 > b.length) throw new Error('short'); out.push({ f, w, v: b.readFloatLE(o) }); o += 4 }
    else if (w === 2) {
      let len: bigint
      ;[len, o] = varint(b, o)
      const end = o + Number(len)
      if (end > b.length) throw new Error('short')
      out.push({ f, w, v: b.subarray(o, end) })
      o = end
    } else throw new Error(`wire type ${w}`)
  }
  return out
}

/** The first sub-message at a path of field numbers, or null. */
function sub(b: Buffer, ...path: number[]): Buffer | null {
  let cur: Buffer = b
  for (const f of path) {
    let fields: Field[]
    try { fields = protoFields(cur) } catch { return null }
    const hit = fields.find((x) => x.f === f && x.w === 2)
    if (!hit) return null
    cur = hit.v as Buffer
  }
  return cur
}

/** A varint field as a signed 32-bit number (protobuf int32: negatives are 10-byte varints); 0 when absent, as protobuf leaves zeros out. */
function int32(fields: Field[], f: number): number {
  const x = fields.find((y) => y.f === f && y.w === 0)
  return x ? Number(BigInt.asIntN(32, x.v as bigint)) : 0
}

export type GimbalPose = {
  t: number; pitch: number; roll: number; yaw: number; droneYaw: number | null
  /** The drone's own position, height above take-off (m) and zoom (1 = 24 mm), where the message has them: for a clip whose SRT is missing. */
  lat?: number; lng?: number; relAlt?: number; zoom?: number
}

/**
 * The camera's angles in every djmd message. `data` is the track's packets end to
 * end (ffmpeg -f data), `sizes` each packet's size and `times` its time in
 * seconds, both from ffprobe. Messages without a gimbal block are skipped.
 * Angles in degrees: pitch below the horizon is negative, yaw a compass bearing.
 */
export function parseDjmd(data: Buffer, sizes: number[], times: number[]): GimbalPose[] {
  const out: GimbalPose[] = []
  let o = 0
  for (let i = 0; i < sizes.length; i++) {
    const pkt = data.subarray(o, o + sizes[i])
    o += sizes[i]
    // frame (3) → gimbal (4) → attitude (3): 1 pitch, 2 roll, 3 yaw, tenths of a degree.
    const att = sub(pkt, 3, 4, 3)
    if (!att) continue
    let g: Field[]
    try { g = protoFields(att) } catch { continue }
    // frame (3) → drone (3) → attitude (3): the aircraft's own yaw, field 3.
    const drone = sub(pkt, 3, 3, 3)
    let droneYaw: number | null = null
    if (drone) { try { droneYaw = compass(int32(protoFields(drone), 3) / 10) } catch { /* left out */ } }
    const pose: GimbalPose = { t: times[i], pitch: int32(g, 1) / 10, roll: int32(g, 2) / 10, yaw: compass(int32(g, 3) / 10), droneYaw }
    // frame (3) → drone (3) → position (4) → (1): 2 latitude, 3 longitude, doubles; → height (5): 1 above take-off in mm.
    const pos = sub(pkt, 3, 3, 4, 1)
    const height = sub(pkt, 3, 3, 5)
    const zoom = sub(pkt, 3, 2, 23)
    try {
      const f = pos ? protoFields(pos) : []
      const lat = f.find((x) => x.f === 2 && x.w === 1)?.v as number | undefined
      const lng = f.find((x) => x.f === 3 && x.w === 1)?.v as number | undefined
      if (lat !== undefined && lng !== undefined && !(lat === 0 && lng === 0)) Object.assign(pose, { lat, lng })
      const h = height ? (protoFields(height).find((x) => x.f === 1 && x.w === 5)?.v as number | undefined) : undefined
      if (h !== undefined) pose.relAlt = h / 1000
      const z = zoom ? (protoFields(zoom).find((x) => x.f === 1 && x.w === 5)?.v as number | undefined) : undefined
      if (z !== undefined && z > 0) pose.zoom = z
    } catch { /* angles alone */ }
    out.push(pose)
  }
  return out
}

const compass = (d: number) => ((d % 360) + 360) % 360

export type XmpPose = { lat: number; lng: number; relAlt: number; pitch: number; roll: number; yaw: number; clock: string | null }

/** A DJI photo's position and gimbal angles from its XMP, or null if it has none. */
export function parseDjiXmp(text: string): XmpPose | null {
  const attr = (name: string) => num(new RegExp(`drone-dji:${name}\\s*=\\s*"([-+]?[\\d.]+)"`), text)
  const lat = attr('GpsLatitude') ?? attr('Latitude')
  const lng = attr('GpsLongitude') ?? attr('Longitude')
  const pitch = attr('GimbalPitchDegree')
  const yaw = attr('GimbalYawDegree')
  if (lat === null || lng === null || pitch === null || yaw === null || (lat === 0 && lng === 0)) return null
  return {
    lat, lng, relAlt: attr('RelativeAltitude') ?? 0, pitch, roll: attr('GimbalRollDegree') ?? 0, yaw: compass(yaw),
    clock: /xmp:CreateDate\s*=\s*"([^"]+)"/.exec(text)?.[1] ?? null,
  }
}

/** The pose at each SRT frame: its position and height, with the gimbal's angles at the nearest djmd time. */
export type Pose = { t: number; lat: number; lng: number; alt: number; pitch: number; yaw: number; focal: number; source: 'djmd' | 'xmp' | 'track' }

/** 35 mm-equivalent focal length when a file doesn't say (Mini 4 Pro at 1×). */
export const DEFAULT_FOCAL = 24

export function joinPoses(frames: SrtFrame[], gimbal: GimbalPose[]): Pose[] {
  if (!gimbal.length) return []
  const g = [...gimbal].sort((a, b) => a.t - b.t)
  let j = 0
  return frames.map((f) => {
    while (j < g.length - 1 && Math.abs(g[j + 1].t - f.t) <= Math.abs(g[j].t - f.t)) j++
    return { t: f.t, lat: f.lat, lng: f.lng, alt: f.relAlt, pitch: g[j].pitch, yaw: g[j].yaw, focal: f.focal ?? DEFAULT_FOCAL, source: 'djmd' as const }
  })
}

/**
 * A clip whose SRT is missing: its frames from the djmd track's own positions
 * and heights (the focal length from its zoom), so it can still be looked at.
 */
export function framesFromDjmd(gimbal: GimbalPose[]): SrtFrame[] {
  return gimbal.filter((g) => g.lat !== undefined && g.lng !== undefined && g.relAlt !== undefined)
    .map((g) => ({ t: g.t, clock: null, lat: g.lat!, lng: g.lng!, relAlt: g.relAlt!, focal: g.zoom ? +(DEFAULT_FOCAL * g.zoom).toFixed(1) : null }))
}

/**
 * With no camera angles at all: face the way the drone moved (over `span`
 * seconds either side, once it has moved `minMove` metres), level. Hovering
 * frames take the last heading. A guess: a drone can fly sideways or backwards.
 */
export function headingFromTrack(frames: SrtFrame[], span = 2, minMove = 3, pitch = -30): Pose[] {
  const R = 6371008.8
  const rad = Math.PI / 180
  const headings: Array<number | null> = []
  let last: number | null = null
  let a = 0
  let b = 0
  for (const f of frames) {
    while (a < frames.length - 1 && frames[a].t < f.t - span) a++
    while (b < frames.length - 1 && frames[b + 1].t <= f.t + span) b++
    const p = frames[a]
    const q = frames[b]
    const dx = (q.lng - p.lng) * rad * R * Math.cos(f.lat * rad)
    const dy = (q.lat - p.lat) * rad * R
    if (Math.hypot(dx, dy) >= minMove) last = compass((Math.atan2(dx, dy) * 180) / Math.PI)
    headings.push(last)
  }
  // Frames before the first move face the way it first went.
  const first = headings.find((h) => h !== null)
  if (first === undefined || first === null) return []
  return frames.map((f, i) => ({ t: f.t, lat: f.lat, lng: f.lng, alt: f.relAlt, pitch, yaw: headings[i] ?? first, focal: f.focal ?? DEFAULT_FOCAL, source: 'track' as const }))
}
