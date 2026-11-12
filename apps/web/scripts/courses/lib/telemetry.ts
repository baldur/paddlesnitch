// Reading a GoPro chapter's GPS and video size with ffmpeg. Shared by ingest.ts
// and look.ts. The parser itself is pure: packages/timing/src/gpmf.ts.
import { execFileSync } from 'child_process'
import { parseGpmfGps } from '@paddlesnitch/timing/gpmf'

// Fixes worse than this are dropped: on the water a MAX sits around 1–2.
export const MAX_DOP = 5

export type ChapterFix = { ft: number; lat: number; lng: number; speed: number; dop: number; utc: string }

export function probeVideo(file: string): { width: number; height: number; duration: number } {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]).toString()
  const j = JSON.parse(out) as { streams: Array<{ width: number; height: number }>; format: { duration: string } }
  return { width: j.streams[0].width, height: j.streams[0].height, duration: Number(j.format.duration) }
}

/**
 * Every usable fix in one chapter, timed in seconds into that file (`ft`). Only
 * the telemetry stream is read, so even a 10 GB chapter takes a second or two.
 */
export function readChapterFixes(file: string, duration: number): { fixes: ChapterFix[]; total: number } {
  const bin = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:m:handler_name:GoPro MET', '-c', 'copy', '-f', 'data', '-'], { maxBuffer: 1 << 30 })
  const { payloads, fixes } = parseGpmfGps(bin)
  const perPayload = duration / payloads
  const kept = fixes.filter((f) => f.fix >= 3 && f.dop <= MAX_DOP).map((f) => ({
    ft: +(f.at * perPayload).toFixed(2), lat: f.lat, lng: f.lng, speed: +f.speed.toFixed(2), dop: f.dop, utc: f.timestamp.toISOString(),
  }))
  return { fixes: kept, total: fixes.length }
}
