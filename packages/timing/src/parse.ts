import type { TrackPoint } from './types'
import { parseGpx } from './gpx'
import { parseFit } from './fit'
import { parseCsv } from './csv'
import { parseTcx } from './tcx'
import { looksLikeSpeedCoach, parseSpeedCoachCsv } from './speedcoach'
import { readZip } from './unzip'
import { gunzipSync } from 'zlib'

export type ParseResult =
  | { ok: true; track: TrackPoint[] }
  | { ok: false; reason: 'unknown_format' | 'parse_error' | 'empty' | 'kml_no_timing' }

const TRACE_EXTS = ['gpx', 'fit', 'csv', 'tcx']

export async function parseTrace(filename: string, data: ArrayBuffer): Promise<ParseResult> {
  const ext = filename.split('.').pop()?.toLowerCase()

  try {
    if (ext === 'gpx') {
      const text = new TextDecoder().decode(data)
      const track = parseGpx(text)
      return track.length > 0 ? { ok: true, track } : { ok: false, reason: 'empty' }
    }

    if (ext === 'fit') {
      const track = await parseFit(data)
      return track.length > 0 ? { ok: true, track } : { ok: false, reason: 'empty' }
    }

    if (ext === 'csv') {
      const text = new TextDecoder().decode(data)
      // NK SpeedCoach exports a multi-section CSV that the generic per-row
      // parser can't read — route it to its own parser first.
      const track = looksLikeSpeedCoach(text) ? parseSpeedCoachCsv(text) : parseCsv(text)
      return track.length > 0 ? { ok: true, track } : { ok: false, reason: 'empty' }
    }

    if (ext === 'tcx') {
      const text = new TextDecoder().decode(data)
      const track = parseTcx(text)
      return track.length > 0 ? { ok: true, track } : { ok: false, reason: 'empty' }
    }

    // KML is a geometry format: Strava/Google exports carry <coordinates> but no
    // per-point timestamps, so a race time can't be computed from one. Reject it
    // with a dedicated reason the upload surfaces as "export GPX/FIT/TCX instead"
    // rather than a confusing generic parse error. (Some tools DO emit a
    // <gx:Track> with <when> times, but the common exports don't — not worth the
    // false promise.)
    if (ext === 'kml') {
      return { ok: false, reason: 'kml_no_timing' }
    }

    // Fitness apps (e.g. Garmin Connect) export a single activity wrapped in a
    // zip. Unwrap it and parse the first supported trace file inside.
    if (ext === 'zip') {
      const entries = readZip(data)
      const inner = entries.find((e) => TRACE_EXTS.includes(e.filename.split('.').pop()?.toLowerCase() ?? ''))
      if (!inner) return { ok: false, reason: 'unknown_format' }
      return parseTrace(inner.filename, inner.data)
    }

    // A trace the browser gzipped before uploading (lib/trace-upload.ts): the
    // server only takes ~4.6 MB per request, and GPX/TCX/CSV text shrinks ~10x.
    // Capped like a zip entry, so a small file can't inflate to fill memory.
    if (ext === 'gz') {
      const inner = filename.slice(0, -3)
      const innerExt = inner.split('.').pop()?.toLowerCase() ?? ''
      if (!TRACE_EXTS.includes(innerExt) && innerExt !== 'zip') return { ok: false, reason: 'unknown_format' }
      const out = gunzipSync(Buffer.from(data), { maxOutputLength: 50 * 1024 * 1024 })
      return parseTrace(inner, out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer)
    }

    return { ok: false, reason: 'unknown_format' }
  } catch {
    return { ok: false, reason: 'parse_error' }
  }
}

// What to tell a person whose file didn't parse. One wording for every upload
// path (trial upload, course check, paddle upload); each used to have its own,
// and one showed the raw reason code.
export function parseFailureMessage(reason: Extract<ParseResult, { ok: false }>['reason']): string {
  switch (reason) {
    case 'kml_no_timing': return 'KML files have no timestamps, so we can’t time them. Export your activity as GPX, FIT or TCX instead.'
    case 'unknown_format': return 'We can’t read that file type. Upload a GPX, FIT, TCX or CSV file, or a Garmin .zip.'
    case 'empty': return 'That file has no GPS points with times. Export the whole activity as GPX, FIT or TCX.'
    case 'parse_error': return 'We couldn’t read that file. It may be damaged. Try exporting it again as GPX, FIT or TCX.'
  }
}
