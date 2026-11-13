#!/usr/bin/env node
// River Explorer: walk the river spot by spot and see what the local model saw,
// pinned on the pictures, and mark whether it was right. Or pick any point on
// the map for every pass's sharp pictures there ("Footage here").
//
//   pnpm --filter web course:explore [--port 3201] [--model qwen2.5vl:32b]   then open http://localhost:3201
//
// Reads the course:look store (lib/footage-db.ts) and can run while course:look
// is looking. The pictures are cut from the clips when first opened and kept in
// the store's views/ folder. Everything stays on this machine: the server
// answers only localhost (lib/explore-server.ts).
// See docs/features/game-courses-from-video.md, "Checking what it saw".
import fs from 'fs'
import path from 'path'
import { eacGraph, eacLayout, flatView, wrapYaw } from './lib/eac'
import { HERE_DIRS, HERE_PANO, HERE_VIEW } from './lib/here'
import { createExplorer, viewFile } from './lib/explore-server'
import { openStore, STORE } from './lib/footage-db'
import { PROMPT_VERSION, VIEW, VIEWS } from './lib/look'
import { LANDMARK_VIEW, LANDMARK_VIEWS } from './lib/landmarks'
import { runDetached } from './lib/proc'

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined }
const PORT = Number(arg('port') ?? 3201)
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) { console.error('stopped: --port must be 1024–65535'); process.exit(1) }
const MODEL = arg('model') ?? 'qwen2.5vl:32b'

const db = openStore()
const viewDir = path.join(STORE, 'views')
fs.mkdirSync(viewDir, { recursive: true })

const server = createExplorer(db, {
  model: MODEL, viewDir,
  // The same views the model was shown (look.ts), written beside their final names and moved in when complete.
  // A careful look's views are the eight closer ones (landmarks.ts).
  cut: async (st, careful) => {
    const [views, view] = careful ? [LANDMARK_VIEWS, LANDMARK_VIEW] : [VIEWS, VIEW]
    const graph = eacGraph(eacLayout(st.width, st.height), views.length) + views.map((v, i) => flatView(i, v.name, { ...view, yaw: v.yaw })).join(';')
    const file = (yaw: number) => viewFile(viewDir, st.id, yaw, careful)
    await runDetached('ffmpeg', ['-v', 'error', '-y', '-ss', st.ft.toFixed(2), '-i', st.path, '-filter_complex', graph,
      ...views.flatMap((v) => ['-map', `[${v.name}]`, '-frames:v', '1', '-q:v', '4', `${file(v.yaw)}.part.jpg`])])
    for (const v of views) fs.renameSync(`${file(v.yaw)}.part.jpg`, file(v.yaw))
  },
  // "Footage here": four sharp views from the bow and the whole 360 with ahead in the middle, best JPEG quality.
  cutHere: async (f, file) => {
    const graph = eacGraph(eacLayout(f.width, f.height), HERE_DIRS.length + 1)
      + HERE_DIRS.map((d, i) => flatView(i, d.name, { ...HERE_VIEW, yaw: f.yaws[d.name] })).join(';')
      + `;[e${HERE_DIRS.length}]v360=eac:e:yaw=${wrapYaw(f.cameraYaw)}:w=${HERE_PANO.w}:h=${HERE_PANO.h}[pano]`
    const outs = [...HERE_DIRS.map((d) => [d.name, d.name] as const), ['pano', '360'] as const]
    try {
      await runDetached('ffmpeg', ['-v', 'error', '-y', '-ss', f.ft.toFixed(2), '-i', f.path, '-filter_complex', graph,
        ...outs.flatMap(([label, name]) => ['-map', `[${label}]`, '-frames:v', '1', '-q:v', '2', `${file(name)}.part.jpg`])])
    } catch (e) {
      for (const [, name] of outs) fs.rmSync(`${file(name)}.part.jpg`, { force: true })
      throw e
    }
    for (const [, name] of outs) fs.renameSync(`${file(name)}.part.jpg`, file(name))
  },
})

server.listen(PORT, '127.0.0.1', () => {
  const n = (db.prepare('SELECT count(DISTINCT station_id) AS n FROM looks WHERE model = ? AND prompt_version = ?').get(MODEL, PROMPT_VERSION) as { n: number }).n
  // The model is named here and on the page: the score is that model's.
  console.log(`River Explorer: http://localhost:${PORT}  (${n} ${n === 1 ? 'spot' : 'spots'} looked at by ${MODEL}; store ${STORE})`)
  if (!n) console.log(`nothing to explore yet for ${MODEL}: run pnpm --filter web course:look first, or pass the --model it used`)
})
server.on('error', (e) => { console.error(`stopped: ${e.message}`); process.exit(1) })
process.on('SIGINT', () => { server.close(); db.close(); process.exit(0) })
