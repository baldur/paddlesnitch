#!/usr/bin/env node
// Step 1 of building a game course from video: read the GPS out of GoPro files.
//
//   pnpm --filter web course:ingest <folder or files…>
//
// GoPro splits a recording into ~25-minute chapters named GSccNNNN.360 (GX… for
// flat video): cc is the chapter, NNNN the recording. Each recording becomes
//   apps/web/.cache/courses/<NNNN>/track.json     every usable fix, on the recording's clock
//   apps/web/.cache/courses/<NNNN>/track.geojson  the same, to drop on a map
// Only the telemetry stream is read, so even 10 GB chapters take a second or two.
// See docs/features/game-courses-from-video.md.
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { parseGpmfGps } from '@paddlesnitch/timing/gpmf'

const CACHE = path.join(process.cwd(), '.cache/courses')
// Fixes worse than this are dropped: on the water a MAX sits around 1–2.
const MAX_DOP = 5

const inputs = process.argv.slice(2).map((p) => path.resolve(process.env.INIT_CWD ?? process.cwd(), p))
if (inputs.length === 0) throw new Error('usage: course:ingest <folder or video files…>')
const files = inputs.flatMap((p) => fs.statSync(p).isDirectory()
  ? fs.readdirSync(p).map((f) => path.join(p, f))
  : [p]).filter((f) => /^G[SXHP]\d{6}\.(360|mp4)$/i.test(path.basename(f)))

const recordings = new Map<string, string[]>()
for (const f of files) {
  const id = path.basename(f).slice(4, 8)
  recordings.set(id, [...(recordings.get(id) ?? []), f])
}

for (const [id, chapters] of recordings) {
  chapters.sort((a, b) => path.basename(a).slice(2, 4).localeCompare(path.basename(b).slice(2, 4)))
  const out = path.join(CACHE, id)
  fs.mkdirSync(out, { recursive: true })
  const track: Array<{ t: number; lat: number; lng: number; speed: number; dop: number; utc: string; file: string; ft: number }> = []
  const sources: Array<{ file: string; offset: number; duration: number }> = []
  let offset = 0
  for (const file of chapters) {
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString())
    const bin = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:m:handler_name:GoPro MET', '-c', 'copy', '-f', 'data', '-'], { maxBuffer: 1 << 30 })
    const { payloads, fixes } = parseGpmfGps(bin)
    const perPayload = duration / payloads
    let kept = 0
    for (const f of fixes) {
      if (f.fix < 3 || f.dop > MAX_DOP) continue
      const ft = f.at * perPayload
      track.push({ t: +(offset + ft).toFixed(2), lat: f.lat, lng: f.lng, speed: +f.speed.toFixed(2), dop: f.dop, utc: f.timestamp.toISOString(), file: path.basename(file), ft: +ft.toFixed(2) })
      kept++
    }
    sources.push({ file, offset, duration })
    console.log(`${path.basename(file)}: ${duration.toFixed(0)} s, ${fixes.length} fixes, ${kept} kept`)
    offset += duration
  }
  fs.writeFileSync(path.join(out, 'track.json'), JSON.stringify({ recording: id, sources, track }))
  fs.writeFileSync(path.join(out, 'track.geojson'), JSON.stringify({
    type: 'Feature', properties: { recording: id },
    geometry: { type: 'LineString', coordinates: track.filter((_, i) => i % 10 === 0).map((p) => [p.lng, p.lat]) },
  }))
  console.log(`recording ${id}: ${(offset / 60).toFixed(0)} min, ${track.length} fixes → ${path.relative(process.cwd(), out)}`)
}
