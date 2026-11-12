// The River Explorer page (course:explore). One file, no libraries, nothing
// fetched from anywhere but the local server. The model's words are put on the
// page as text, never as HTML. The server allows only this one script, by hash
// (explore-server.ts), so keep it the page's only <script>.
export const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>River Explorer</title>
<style>
:root{--bg:#0b1220;--surface:#0f172a;--surface2:#1e293b;--border:#1e293b;--fg:#e2e8f0;--muted:#94a3b8;--track:#475569;--primary:#38bdf8;--green:#22c55e;--red:#f87171;--amber:#fbbf24}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 "IBM Plex Sans",system-ui,sans-serif}
.num,.pin,kbd,.score b{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace}
header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)}
h1{font-size:16px;margin:0}
h1 small{color:var(--muted);font-weight:400;font-size:13px}
.score{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}
.score b{font-size:22px;color:var(--primary)}
.muted{color:var(--muted)}
#status{min-height:1.4em;color:var(--amber)}
main{display:grid;grid-template-columns:260px 1fr;gap:16px;padding:16px}
main>section{order:2}main>aside{order:1}
@media (max-width:900px){main{grid-template-columns:1fr}main>section{order:1}main>aside{order:2}}
aside{display:flex;flex-direction:column;gap:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px}
.card h2{font-size:11px;letter-spacing:.1em;color:var(--muted);margin:0 0 8px;font-weight:500}
svg#map{width:100%;height:auto;display:block}
#map .hit{cursor:pointer;fill:transparent}
.kinds div{display:grid;grid-template-columns:1fr 70px 40px;gap:8px;align-items:center;margin:3px 0}
.bar{height:6px;background:var(--surface2);position:relative}.bar i{position:absolute;inset:0 auto 0 0;background:var(--green)}
.spothead{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-bottom:12px}
.spothead strong{font-size:14px}
.chip{border:1px solid var(--border);border-radius:6px;padding:2px 8px;color:var(--muted)}
button{font:inherit;color:var(--fg);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 12px;min-height:36px;cursor:pointer}
button:hover:not(:disabled){border-color:var(--primary)}button:disabled{opacity:.35;cursor:default}
.views{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
@media (min-width:1500px){.views{grid-template-columns:repeat(4,1fr)}}
@media (max-width:600px){.views{grid-template-columns:1fr}}
.view h3{font-size:11px;letter-spacing:.1em;margin:0 0 4px;color:var(--muted);font-weight:500}
.view h3 b{color:var(--fg)}
.pic{position:relative;aspect-ratio:1024/640;background:var(--surface2);overflow:hidden}
.pic.can-add{cursor:crosshair}
.pic img{width:100%;height:100%;object-fit:cover;display:block}
.pic .wait{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted)}
.pin{position:absolute;transform:translateY(-50%);display:flex;align-items:center;gap:4px;padding:3px 6px 3px 4px;margin:0;background:rgba(11,18,32,.85);border:1px solid var(--primary);border-radius:4px;color:var(--fg);font-size:11px;line-height:1.2;cursor:pointer;white-space:nowrap;min-height:0;overflow:hidden;text-overflow:ellipsis}
.pin::before{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:var(--primary)}
.pin.right{border-color:var(--green)}.pin.right::before{content:"✓";width:auto;height:auto;background:none;color:var(--green);font-size:11px}
.pin.wrong{border-color:var(--red);text-decoration:line-through;opacity:.85}.pin.wrong::before{content:"✗";width:auto;height:auto;background:none;color:var(--red);font-size:11px}
.pin.missed{border:1px dashed var(--amber);transform:translate(-50%,-50%)}.pin.missed::before{background:var(--amber)}
.pin:focus-visible,.pin:hover{z-index:2;outline:2px solid var(--fg)}
.tip{position:absolute;z-index:3;left:0;right:0;top:0;padding:6px 8px;background:rgba(11,18,32,.92);font-size:12px;pointer-events:none}
.scene{color:var(--muted);margin:6px 0 0;min-height:2.9em}
.mark{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid var(--amber);border-radius:50%;pointer-events:none}
.add{position:absolute;z-index:4;background:var(--surface);border:1px solid var(--amber);border-radius:6px;padding:6px;display:flex;gap:4px;margin:0}
.add select{font:inherit;background:var(--surface2);color:var(--fg);border:1px solid var(--border);border-radius:6px;min-height:32px;max-width:150px}
.add button{min-height:32px;padding:4px 10px}
.others{display:flex;flex-wrap:wrap;gap:8px}
.help{color:var(--muted);font-size:12px;margin:0}
.help kbd{border:1px solid var(--border);border-radius:4px;padding:0 4px;color:var(--fg)}
.empty{padding:48px 16px;text-align:center;color:var(--muted)}
</style></head>
<body>
<header>
  <h1>River Explorer <small id="model"></small></h1>
  <div class="score" id="score"></div>
  <div id="status" role="status"></div>
</header>
<main>
  <aside>
    <div class="card"><h2>WHERE</h2><svg id="map" viewBox="0 0 300 300" role="img" aria-label="Map of the spots looked at"></svg>
      <p class="help"><span style="color:var(--green)">●</span> all marked &nbsp;<span style="color:var(--primary)">●</span> some unmarked &nbsp;<span style="color:var(--muted)">●</span> nothing to mark</p></div>
    <div class="card kinds" id="kinds"></div>
    <div class="card help">
      <h2>HOW</h2>
      <p class="help">Click a pin if it's <span style="color:var(--green)">right</span>. Right-click or shift-click if it's <span style="color:var(--red)">made up</span>. The same again clears it.</p>
      <p class="help">Click the picture where the model missed something to add it.</p>
      <p class="help"><kbd>←</kbd> <kbd>→</kbd> along the clip &nbsp;<kbd>n</kbd> next unmarked spot<br>On a pin: <kbd>r</kbd> right <kbd>x</kbd> made up <kbd>0</kbd> clear<br><kbd>A</kbd> mark the rest of this spot right</p>
    </div>
  </aside>
  <section id="spot"><div class="empty">Loading…</div></section>
</main>
<script>
const KINDS = __KINDS__
let all = [], tracks = [], current = null, adding = null, seq = 0, busy = false
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) if (k != null && k !== false) e.append(k); return e }
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many)
const say = (text) => { document.getElementById('status').textContent = text || '' }
const api = async (url, body) => {
  let r
  try { r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }
  catch { throw new Error("Couldn't reach course:explore. Check it's still running.") }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Something went wrong.')
  return r.json()
}
const pct = (r) => r == null ? '–' : Math.round(r * 100) + '%'
const clock = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
const VERDICT_WORD = { right: 'right', wrong: 'made up' }

function drawScore(s) {
  const box = document.getElementById('score'); box.replaceChildren()
  const done = all.filter((x) => !x.things || x.checked >= x.things).length
  box.append(el('span', {}, el('b', { textContent: pct(s.rate) }), ' right'),
    el('span', { className: 'muted num', textContent: s.checked + ' marked · ' + s.wrong + ' made up · ' + s.missed + ' missed · ' + done + '/' + all.length + ' spots done' }))
  const k = document.getElementById('kinds'); k.replaceChildren(el('h2', { textContent: 'RIGHT BY KIND' }))
  if (!s.byKind.length) k.append(el('p', { className: 'help', textContent: 'Mark a few pins to see how the model does on each kind of thing.' }))
  for (const r of s.byKind.slice(0, 12)) {
    k.append(el('div', {}, el('span', { textContent: r.kind }), el('div', { className: 'bar' }, el('i', { style: 'width:' + Math.round(r.rate * 100) + '%' })),
      el('span', { className: 'muted num', textContent: r.right + '/' + (r.right + r.wrong) })))
  }
}

function drawMap() {
  const svg = document.getElementById('map'); svg.replaceChildren()
  if (!all.length) return
  const lat0 = all.reduce((a, s) => a + s.lat, 0) / all.length, k = Math.cos(lat0 * Math.PI / 180)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  const see = (lat, lng) => { const x = lng * k, y = -lat; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  for (const s of all) see(s.lat, s.lng)
  for (const t of tracks) for (const [la, ln] of t) see(la, ln)
  const sc = 280 / Math.max(x1 - x0, y1 - y0, 1e-6)
  const P = (lat, lng) => [10 + (lng * k - x0) * sc, 10 + (-lat - y0) * sc]
  const ns = 'http://www.w3.org/2000/svg', mk = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const a in attrs) e.setAttribute(a, attrs[a]); return e }
  for (const t of tracks) svg.append(mk('polyline', { points: t.map(([la, ln]) => P(la, ln).join(',')).join(' '), fill: 'none', stroke: 'var(--track)', 'stroke-width': 1.5 }))
  for (const s of all) {
    const [cx, cy] = P(s.lat, s.lng), here = current && s.id === current.id
    const fill = !s.things ? 'var(--muted)' : s.checked >= s.things ? 'var(--green)' : 'var(--primary)'
    svg.append(mk('circle', { cx, cy, r: here ? 7 : 5, fill, stroke: here ? 'var(--fg)' : 'none', 'stroke-width': 2 }))
    const hit = mk('circle', { cx, cy, r: 11, class: 'hit' })
    hit.append(Object.assign(document.createElementNS(ns, 'title'), { textContent: s.clip + ' at ' + clock(s.ft) + ' · ' + plural(s.things, 'thing', 'things') }))
    hit.addEventListener('click', () => go(s.id))
    svg.append(hit)
  }
}

/** Show a spot. Only the latest call draws, however fast the keys are pressed. */
async function go(id) {
  const mine = ++seq
  closeAdd()
  say('')
  let s
  try { s = await api('/api/spot/' + id) } catch (e) { if (mine === seq) say(e.message); return }
  if (mine !== seq) return
  current = s
  history.replaceState(null, '', '#' + id)
  drawSpot(); drawMap()
  document.querySelector('.pin:not(.right):not(.wrong):not(.missed)')?.focus({ preventScroll: true })
  // Have the next spots' pictures cut while this one is looked at.
  for (const nid of [s.next, nextUnmarked()?.id]) if (nid != null) for (const v of s.views) new Image().src = '/view/' + nid + '/' + v.viewYaw + '.jpg'
}

function nextUnmarked() {
  const i = all.findIndex((s) => s.id === current.id)
  return [...all.slice(i + 1), ...all.slice(0, i)].find((s) => s.things && s.checked < s.things)
}

function updateChecked(spotId, views) {
  const s = all.find((x) => x.id === spotId)
  if (s) s.checked = views.flatMap((v) => v.pins).filter((p) => p.verdict).length
  drawMap()
  if (current && current.id === spotId) for (const v of current.views) v.head.textContent = headText(v)
}

async function setVerdict(spotId, views, p, b, verdict) {
  const before = p.verdict
  p.verdict = verdict; b.className = 'pin' + (verdict ? ' ' + verdict : ''); b.ariaLabel = pinLabel(p)
  updateChecked(spotId, views)
  try { drawScore((await api('/api/review', { itemId: p.id, verdict })).score); say('') }
  catch (e) { p.verdict = before; b.className = 'pin' + (before ? ' ' + before : ''); b.ariaLabel = pinLabel(p); updateChecked(spotId, views); say("Couldn't save that mark. " + e.message) }
}

const pinLabel = (p) => p.label + ': ' + p.detail + (p.verdict ? ' (' + VERDICT_WORD[p.verdict] + ')' : '')

function pinFor(p) {
  const s = current
  const b = el('button', { className: 'pin' + (p.verdict ? ' ' + p.verdict : ''), textContent: p.label, ariaLabel: pinLabel(p) })
  b.style.left = (p.px * 100) + '%'; b.style.top = (p.py * 100) + '%'; b.style.maxWidth = (p.w * 100 + 2) + '%'
  const tip = el('div', { className: 'tip', textContent: p.kind + ' · ' + p.distance + ' · ' + p.detail })
  const show = () => b.parentElement.append(tip), hide = () => tip.remove()
  b.addEventListener('mouseenter', show); b.addEventListener('mouseleave', hide); b.addEventListener('focus', show); b.addEventListener('blur', hide)
  const toggle = (v) => setVerdict(s.id, s.views, p, b, p.verdict === v ? null : v)
  b.addEventListener('click', (e) => { e.stopPropagation(); toggle(e.shiftKey ? 'wrong' : 'right') })
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); toggle('wrong') })
  b.addEventListener('keydown', (e) => {
    const v = { r: 'right', x: 'wrong', 0: null }[e.key]
    if (v !== undefined) { e.preventDefault(); e.stopPropagation(); setVerdict(s.id, s.views, p, b, v) }
  })
  return b
}

function missedPin(view, m) {
  const b = el('button', { className: 'pin missed', textContent: m.kind, ariaLabel: m.kind + ' (you added this; click to remove)' })
  b.style.left = (m.x * 100) + '%'; b.style.top = (m.y * 100) + '%'
  b.addEventListener('click', async (e) => {
    e.stopPropagation()
    try { drawScore((await api('/api/missed', { remove: m.id })).score); view.missed = view.missed.filter((x) => x !== m); drawPins(view) }
    catch (err) { say("Couldn't remove that. " + err.message) }
  })
  return b
}

function closeAdd() { if (adding) { adding.box.remove(); adding.mark.remove(); adding = null } }

function addBox(view, x, y) {
  closeAdd()
  const pic = view.pic
  const sel = el('select', { ariaLabel: 'What did it miss?' }, ...KINDS.map((k) => el('option', { value: k, textContent: k })))
  const box = el('form', { className: 'add' }, sel, el('button', { type: 'submit', textContent: 'Add' }), el('button', { type: 'button', textContent: '×', ariaLabel: 'Cancel' }))
  const mark = el('div', { className: 'mark' }); mark.style.left = (x * 100) + '%'; mark.style.top = (y * 100) + '%'
  // Open beside the click, on whichever side has room, inside the picture.
  if (x < 0.5) box.style.left = 'calc(' + (x * 100) + '% + 10px)'; else box.style.right = 'calc(' + ((1 - x) * 100) + '% + 10px)'
  if (y < 0.6) box.style.top = (y * 100) + '%'; else box.style.bottom = ((1 - y) * 100) + '%'
  box.addEventListener('click', (e) => e.stopPropagation())
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAdd() } })
  box.lastChild.addEventListener('click', closeAdd)
  box.addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      const r = await api('/api/missed', { lookId: view.lookId, kind: sel.value, x, y })
      view.missed.push({ id: r.id, kind: sel.value, x, y }); drawScore(r.score); closeAdd(); drawPins(view)
    } catch (err) { say("Couldn't add that. " + err.message) }
  })
  pic.append(mark, box); adding = { box, mark }; sel.focus()
}

/** Just the pins of one view: the picture itself stays as it is. */
function drawPins(view) {
  view.pic.querySelectorAll('.pin,.tip').forEach((n) => n.remove())
  for (const p of view.pins) view.pic.append(pinFor(p))
  for (const m of view.missed) view.pic.append(missedPin(view, m))
}

const headText = (v) => ' · ' + v.pins.filter((p) => p.verdict).length + ' of ' + plural(v.pins.length, 'thing', 'things') + ' marked'

function drawSpot() {
  const box = document.getElementById('spot'); box.replaceChildren()
  const s = current
  const v0 = s.views.find((v) => v.water)
  const prev = el('button', { textContent: '← Previous', disabled: s.prev == null }), next = el('button', { textContent: 'Next →', disabled: s.next == null })
  prev.addEventListener('click', () => go(s.prev)); next.addEventListener('click', () => go(s.next))
  box.append(el('div', { className: 'spothead' },
    el('strong', { textContent: s.clip + ' at ' + clock(s.ft) }),
    el('span', { className: 'chip num', textContent: 'every ' + (100 / 2 ** s.level) + ' m' }),
    v0 && el('span', { className: 'chip', textContent: 'water: ' + v0.water }),
    v0 && el('span', { className: 'chip', textContent: 'light: ' + v0.light }),
    s.cameraYaw == null && el('span', { className: 'chip', title: 'The camera direction isn\\'t known for this clip yet, so ahead and behind may be swapped.', textContent: 'camera direction assumed' }),
    prev, next))
  const grid = el('div', { className: 'views' })
  for (const v of s.views) {
    const pic = el('div', { className: 'pic' + (v.lookId ? ' can-add' : '') }, el('div', { className: 'wait', textContent: 'Cutting the picture…' }))
    const img = el('img', { alt: v.name + ' view', src: '/view/' + s.id + '/' + v.viewYaw + '.jpg' })
    img.addEventListener('load', () => pic.querySelector('.wait')?.remove())
    img.addEventListener('error', () => { const w = pic.querySelector('.wait'); if (w) w.textContent = "Couldn't cut this picture. Check the clip is still on this machine." })
    pic.prepend(img)
    v.pic = pic
    if (v.lookId) pic.addEventListener('click', (e) => { const r = pic.getBoundingClientRect(); addBox(v, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height) })
    v.head = el('span', { className: 'num', textContent: headText(v) })
    grid.append(el('div', { className: 'view' }, el('h3', {}, el('b', { textContent: v.name.toUpperCase() }), v.head),
      pic, el('p', { className: 'scene', textContent: v.ok ? v.scene : v.lookId ? 'The model gave no usable answer here.' : 'Not looked at yet.' })))
    drawPins(v)
  }
  box.append(grid)
  if (s.others.length) {
    const o = el('div', { className: 'others' })
    for (const x of s.others) { const b = el('button', { textContent: x.clip + (x.day ? ' · ' + x.day : '') + ' · ' + x.metres + ' m away' }); b.addEventListener('click', () => go(x.id)); o.append(b) }
    box.append(el('div', { className: 'card', style: 'margin-top:16px' }, el('h2', { textContent: 'SAME PLACE, OTHER DAYS' }), o))
  }
}

async function markRestRight() {
  if (busy) return
  const s = current, pins = s.views.flatMap((v) => v.pins).filter((p) => !p.verdict)
  if (!pins.length) return say('Nothing left to mark here.')
  busy = true
  try {
    const r = await api('/api/review', { itemIds: pins.map((p) => p.id), verdict: 'right' })
    for (const p of pins) if (r.saved.includes(p.id)) p.verdict = 'right'
    drawScore(r.score); updateChecked(s.id, s.views)
    if (current === s) for (const v of s.views) drawPins(v)
    say('Marked ' + plural(r.saved.length, 'pin', 'pins') + ' right. Click one to change it.')
  } catch (e) { say("Couldn't save those marks. " + e.message) }
  finally { busy = false }
}

document.addEventListener('click', (e) => { if (adding && !adding.box.contains(e.target)) closeAdd() }, true)
document.addEventListener('keydown', (e) => {
  if (!current || e.target.closest?.('select,.add') || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'Escape') closeAdd()
  else if (e.key === 'ArrowLeft' && current.prev != null) go(current.prev)
  else if (e.key === 'ArrowRight' && current.next != null) go(current.next)
  else if (e.key === 'n') { const nxt = nextUnmarked(); nxt ? go(nxt.id) : say('Every spot is marked.') }
  else if (e.key === 'A' && !e.repeat) markRestRight()
})

;(async () => {
  const d = await api('/api/spots')
  all = d.spots; tracks = d.tracks
  document.getElementById('model').textContent = '· ' + d.model + ' · ' + plural(all.length, 'spot', 'spots')
  drawScore(await api('/api/score'))
  if (!all.length) { document.getElementById('spot').replaceChildren(el('div', { className: 'empty', textContent: 'Nothing to explore yet. Run pnpm --filter web course:look first.' })); return }
  const fromHash = Number(location.hash.slice(1))
  await go(all.some((s) => s.id === fromHash) ? fromHash : all[0].id)
})().catch((e) => { document.getElementById('spot').replaceChildren(el('div', { className: 'empty', textContent: "Couldn't load the spots. " + e.message })) })
</script>
</body></html>`
