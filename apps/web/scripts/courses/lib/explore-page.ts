// The River Explorer page (course:explore). One file, no libraries, nothing
// fetched from anywhere but the local server. The model's words are put on the
// page as text, never as HTML. The server allows only this one script, by hash
// (explore-server.ts), so keep it the page's only <script>.
export const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>River Explorer</title>
<style>
:root{--bg:#0b1220;--surface:#0f172a;--surface2:#1e293b;--border:#1e293b;--fg:#e2e8f0;--muted:#94a3b8;--track:#475569;--primary:#38bdf8;--green:#22c55e;--red:#f87171;--amber:#fbbf24;--violet:#a78bfa}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 "IBM Plex Sans",system-ui,sans-serif}
.num,.pin,kbd,.score b{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace}
header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)}
h1{font-size:16px;margin:0}
h1 small{color:var(--muted);font-weight:400;font-size:13px}
.score{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}
.score b{font-size:22px;color:var(--primary)}
.muted{color:var(--muted)}
#status{min-height:1.4em;color:var(--muted)}#status.error{color:var(--amber)}
main{display:grid;grid-template-columns:260px 1fr;gap:16px;padding:16px}
main>section{order:2}main>aside{order:1}
@media (max-width:900px){main{grid-template-columns:1fr}main>section{order:1}main>aside{order:2}}
aside{display:flex;flex-direction:column;gap:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px}
.card h2{font-size:12px;color:var(--muted);margin:0 0 8px;font-weight:600}
svg#map{width:100%;height:auto;display:block}
#map{cursor:crosshair;touch-action:none;user-select:none;-webkit-user-select:none}
#map *{vector-effect:non-scaling-stroke}
#map .hit{cursor:pointer;fill:transparent}
.maptools{display:flex;gap:6px;margin-top:6px}
.maptools button{min-height:28px;padding:2px 8px;font-size:12px}
@media (max-width:900px){#bigger{display:none}}
.areaform{flex-wrap:wrap}.areaform .est{flex-basis:100%;font-size:12px;color:var(--muted)}.areaform .est.big{color:var(--amber)}
#status button{min-height:0;padding:0 8px;margin-left:8px;font-size:12px}
@media (min-width:901px){.bigmap main{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
#map .area{fill:rgba(167,139,250,.1);stroke:var(--violet);stroke-width:1.5;stroke-dasharray:4 3}
#map .area.open{stroke-width:2.5;stroke-dasharray:none}
#map .area-name{fill:var(--violet);font-family:"IBM Plex Mono",ui-monospace,monospace}
#map .find{fill:var(--violet);stroke:var(--bg);stroke-width:1}
.areaform{display:flex;gap:4px;margin-top:8px}
.areaform input{font:inherit;flex:1;min-width:0;background:var(--surface2);color:var(--fg);border:1px solid var(--violet);border-radius:6px;min-height:32px;padding:0 8px}
.areaform button{min-height:32px;padding:4px 10px}
.arealist{display:flex;flex-direction:column;gap:6px}
.arealist .row{display:flex;gap:4px;align-items:stretch}
.arealist .row button:first-child{flex:1;text-align:left;min-height:32px;padding:4px 8px}
.arealist .row button:last-child{min-height:32px;padding:4px 10px}
.arealist small{display:block;color:var(--muted)}
.cmd{display:block;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;background:var(--surface2);border-radius:4px;padding:6px 8px;margin:6px 0 0;color:var(--fg);user-select:all;overflow-wrap:anywhere}
.finds{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.find h3{font-size:13px;margin:6px 0 2px;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.find p{margin:2px 0;color:var(--muted)}
.find .meta{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:12px;color:var(--muted)}
.find .meta button{min-height:28px;padding:2px 8px;font-size:12px}
.pic .box{position:absolute;border:2px solid var(--violet);box-shadow:0 0 0 1px rgba(11,18,32,.6);pointer-events:none}
.sure{color:var(--green)}.maybe{color:var(--amber)}
.kinds div{display:grid;grid-template-columns:1fr 70px 40px;gap:8px;align-items:center;margin:3px 0}
.bar{height:6px;background:var(--surface2);position:relative}.bar i{position:absolute;inset:0 auto 0 0;background:var(--green)}
.spothead{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-bottom:12px}
.spothead strong{font-size:14px}
.chip{border:1px solid var(--border);border-radius:6px;padding:2px 8px;color:var(--muted)}
button{font:inherit;color:var(--fg);background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 12px;min-height:36px;cursor:pointer}
button:hover:not(:disabled){border-color:var(--primary)}button:disabled{opacity:.35;cursor:default}
.views{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
@media (min-width:1500px){.views{grid-template-columns:repeat(4,1fr)}}
/* Two rows of pictures fit the window, so no scrolling on each spot. */
@media (min-width:601px) and (max-width:1499px){.views{max-width:calc((100vh - 280px) * 1.6 + 12px)}}
@media (max-width:600px){.views{grid-template-columns:1fr}}
.view h3{font-size:12px;margin:0 0 4px;color:var(--muted);font-weight:500}
.view h3 b{color:var(--fg)}
.pic{position:relative;aspect-ratio:1024/640;background:var(--surface2);overflow:hidden}
.pic.can-add{cursor:crosshair}
.pic img{width:100%;height:100%;object-fit:cover;display:block}
.pic .wait{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted)}
.pin{position:absolute;transform:translateY(-50%);display:flex;align-items:center;gap:4px;padding:3px 6px 3px 4px;margin:0;background:rgba(11,18,32,.85);border:1px solid var(--primary);border-radius:4px;color:var(--fg);font-size:11px;line-height:1.2;cursor:pointer;white-space:nowrap;min-height:0}
.pin::before{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:var(--primary)}
.pin.right{border-color:var(--green)}.pin.right::before{content:"✓";width:auto;height:auto;background:none;color:var(--green);font-size:11px}
.pin.wrong{border-color:var(--red);text-decoration:line-through;opacity:.85}.pin.wrong::before{content:"✗";width:auto;height:auto;background:none;color:var(--red);font-size:11px}
.pin.missed{border:1px dashed var(--amber);transform:translate(-50%,-50%)}.pin.missed::before{background:var(--amber)}
.pin:focus-visible,.pin:hover{z-index:2;outline:2px solid var(--fg)}
.tip{position:absolute;z-index:3;left:0;right:0;top:0;padding:6px 8px;background:rgba(11,18,32,.92);font-size:12px;pointer-events:none}
.scene{color:var(--muted);margin:6px 0 0}
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
    <div class="card"><h2>Where</h2><svg id="map" viewBox="0 0 300 300" role="img" aria-label="Map of the spots looked at"></svg>
      <p class="help"><span style="color:var(--green)">●</span> all marked &nbsp;<span style="color:var(--primary)">●</span> some unmarked &nbsp;<span style="color:var(--muted)">●</span> nothing to mark</p>
      <div class="maptools"><button type="button" id="bigger">Bigger map</button><button type="button" id="unzoom" disabled>Zoom out</button></div>
      <p class="help"><span style="color:var(--violet)">Drag on the map</span> to draw an area to look at carefully. Scroll to zoom in first, and keep it to 100–300 m of river: each pass through it takes 20–60 min. Shift-drag moves a zoomed map.</p>
      <div id="areaform"></div></div>
    <div class="card" id="areas"></div>
    <div class="card help">
      <h2>How to mark</h2>
      <p class="help">Click a pin if it's <span style="color:var(--green)">right</span>. Right-click or shift-click if it's <span style="color:var(--red)">made up</span>. The same again clears it.</p>
      <p class="help">Click the picture where the model missed something to add it.</p>
      <p class="help"><kbd>←</kbd> <kbd>→</kbd> along the clip &nbsp;<kbd>n</kbd> next unmarked spot<br>On a pin: <kbd>r</kbd> right <kbd>x</kbd> made up <kbd>0</kbd> clear<br><kbd>Shift</kbd>+<kbd>A</kbd> mark the rest of this spot right</p>
    </div>
    <div class="card kinds" id="kinds"></div>
  </aside>
  <section id="spot"><div class="empty">Loading…</div></section>
</main>
<script>
const KINDS = __KINDS__
let mapZoom = { z: 1, x: 0, y: 0 }, mapH = 300, lastSpot = null
let all = [], tracks = [], areas = [], openArea = null, drawingArea = null, mapProj = null, current = null, adding = null, seq = 0, busy = false, scoreSeq = 0, picW = 520
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) if (k != null && k !== false) e.append(k); return e }
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many)
const say = (text, error) => { const s = document.getElementById('status'); s.textContent = text || ''; s.className = error ? 'error' : '' }
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

/** A reply's score, unless a later reply has already drawn one. */
const scoreFrom = (n) => (s) => { if (n >= scoreSeq) { scoreSeq = n; drawScore(s) } }
let replies = 0
function drawScore(s) {
  const box = document.getElementById('score'); box.replaceChildren()
  const done = all.filter((x) => !x.things || x.checked >= x.things).length
  box.append(el('span', {}, el('b', { textContent: pct(s.rate) }), ' right'),
    el('span', { className: 'muted num', textContent: plural(s.checked, 'pin', 'pins') + ' marked · ' + s.wrong + ' made up · ' + s.missed + ' it missed · ' + done + ' of ' + plural(all.length, 'spot', 'spots') + ' marked' }))
  const k = document.getElementById('kinds'); k.replaceChildren(el('h2', { textContent: 'Right by kind' }))
  if (!s.byKind.length) k.append(el('p', { className: 'help', textContent: 'Mark a few pins to see how the model does on each kind of thing.' }))
  for (const r of s.byKind.slice(0, 12)) {
    k.append(el('div', {}, el('span', { textContent: r.kind }), el('div', { className: 'bar' }, el('i', { style: 'width:' + Math.round(r.rate * 100) + '%' })),
      el('span', { className: 'muted num', textContent: r.right + '/' + (r.right + r.wrong) })))
  }
}

function drawMap() {
  const svg = document.getElementById('map'); svg.replaceChildren()
  // The tracks alone are enough to draw an area on, before the general look has any spots.
  const pts = all.length ? all : tracks.flat().map(([lat, lng]) => ({ lat, lng }))
  if (!pts.length) return
  const lat0 = pts.reduce((a, s) => a + s.lat, 0) / pts.length, k = Math.cos(lat0 * Math.PI / 180)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  const see = (lat, lng) => { const x = lng * k, y = -lat; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  for (const s of all) see(s.lat, s.lng)
  for (const t of tracks) for (const [la, ln] of t) see(la, ln)
  // As tall as the river needs, so a long thin stretch isn't a line in an empty square.
  const sc = 280 / Math.max(x1 - x0, 1e-6), h = Math.min(Math.max((y1 - y0) * sc, 100), 420) + 20
  const scale = Math.min(sc, (h - 20) / Math.max(y1 - y0, 1e-6))
  mapH = h
  const z = mapZoom.z
  svg.setAttribute('viewBox', z === 1 ? '0 0 300 ' + h : mapZoom.x + ' ' + mapZoom.y + ' ' + 300 / z + ' ' + h / z)
  document.getElementById('unzoom').disabled = z === 1
  // Map units per screen pixel: dots and labels keep their size however big or zoomed the map is.
  const u = (300 / z) / (svg.clientWidth || 260)
  const P = (lat, lng) => [10 + (lng * k - x0) * scale, 10 + (-lat - y0) * scale]
  // And back, for an area drawn on the map.
  mapProj = { P, toLatLng: (X, Y) => ({ lat: -((Y - 10) / scale + y0), lng: ((X - 10) / scale + x0) / k }) }
  const ns = 'http://www.w3.org/2000/svg', mk = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const a in attrs) e.setAttribute(a, attrs[a]); return e }
  for (const t of tracks) svg.append(mk('polyline', { points: t.map(([la, ln]) => P(la, ln).join(',')).join(' '), fill: 'none', stroke: 'var(--track)', 'stroke-width': 1.5 }))
  for (const a of areas) {
    const [ax, ay] = P(a.north, a.west), [bx, by] = P(a.south, a.east)
    const r = mk('rect', { x: ax, y: ay, width: Math.max(bx - ax, 1), height: Math.max(by - ay, 1), class: 'area' + (openArea && openArea.id === a.id ? ' open' : '') })
    r.append(Object.assign(document.createElementNS(ns, 'title'), { textContent: a.name }))
    svg.append(r)
    svg.append(Object.assign(mk('text', { x: ax, y: ay - 3 * u, class: 'area-name', 'font-size': 11 * u }), { textContent: a.name }))
  }
  if (openArea) for (const t of openArea.things) {
    const [cx, cy] = P(t.lat, t.lng), c = mk('circle', { cx, cy, r: 3 * u, class: 'find' })
    c.append(Object.assign(document.createElementNS(ns, 'title'), { textContent: t.name }))
    svg.append(c)
  }
  if (drawingArea) svg.append(drawingArea)
  for (const s of all) {
    const [cx, cy] = P(s.lat, s.lng), here = current && s.id === current.id
    const fill = !s.things ? 'var(--muted)' : s.checked >= s.things ? 'var(--green)' : 'var(--primary)'
    svg.append(mk('circle', { cx, cy, r: (here ? 7 : 5) * u, fill, stroke: here ? 'var(--fg)' : 'none', 'stroke-width': 2 }))
    const hit = mk('circle', { cx, cy, r: 8 * u, class: 'hit' })
    hit.append(Object.assign(document.createElementNS(ns, 'title'), { textContent: s.clip + ' at ' + clock(s.ft) + ' · ' + plural(s.things, 'pin', 'pins') }))
    hit.addEventListener('mouseenter', () => svg.append(hit)) // the one under the mouse wins a click
    hit.addEventListener('click', () => go(s.id))
    svg.append(hit)
  }
}

/** Show a spot. Only the latest call draws, however fast the keys are pressed. */
async function go(id) {
  if (id == null) return
  const mine = ++seq
  closeAdd()
  openArea = null
  say('')
  let s
  try { s = await api('/api/spot/' + id + '?w=' + Math.round(measurePic())) } catch (e) { if (mine === seq) say(e.message, true); return }
  if (mine !== seq) return
  current = s
  history.replaceState(null, '', '#' + id)
  drawSpot(); drawMap()
  focusNext()
  // Once the owner has stopped on this spot, have the next spots' pictures cut while it's looked at.
  setTimeout(() => {
    if (mine !== seq) return
    for (const nid of [s.next, nextUnmarked()?.id]) if (nid != null) for (const v of s.views) new Image().src = '/view/' + nid + '/' + v.viewYaw + '.jpg'
  }, 500)
}

/** How wide a picture is on screen (the pins are laid out for it). */
function measurePic() {
  const pic = document.querySelector('.pic')
  if (pic) return (picW = pic.clientWidth || picW)
  const probe = el('div', { className: 'views', style: 'visibility:hidden' }, el('div', { className: 'pic' }))
  document.getElementById('spot').append(probe)
  picW = probe.firstChild.clientWidth || picW
  probe.remove()
  return picW
}

/** Focus the first unmarked pin, in this view if given, so r / x / 0 work straight away. */
function focusNext(view) {
  const root = view ? view.pic : document
  ;(root.querySelector('.pin:not(.right):not(.wrong):not(.missed)') || (view && view.pic.querySelector('.pin')))?.focus({ preventScroll: true })
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
  if (busy) return say('Wait a moment: still saving the rest of this spot.', true)
  const before = p.verdict
  p.verdict = verdict; b.className = 'pin' + (verdict ? ' ' + verdict : ''); b.ariaLabel = pinLabel(p)
  updateChecked(spotId, views)
  const n = ++replies
  try { scoreFrom(n)((await api('/api/review', { itemId: p.id, verdict })).score); say('') }
  catch (e) { p.verdict = before; b.className = 'pin' + (before ? ' ' + before : ''); b.ariaLabel = pinLabel(p); updateChecked(spotId, views); say("Couldn't save that mark. " + e.message, true) }
}

const pinLabel = (p) => p.label + ': ' + p.detail + (p.verdict ? ' (' + VERDICT_WORD[p.verdict] + ')' : '')

function pinFor(p) {
  const s = current
  const b = el('button', { className: 'pin' + (p.verdict ? ' ' + p.verdict : ''), textContent: p.label, ariaLabel: pinLabel(p) })
  b.style.left = (p.px * 100) + '%'; b.style.top = (p.py * 100) + '%'; b.style.maxWidth = (p.w * 100 + 2) + '%'
  const tip = el('div', { className: 'tip', textContent: p.kind + ' · ' + p.distance + ' · ' + p.detail })
  const show = () => { b.parentElement.querySelectorAll('.tip').forEach((t) => t.remove()); b.parentElement.append(tip) }, hide = () => tip.remove()
  b.addEventListener('mouseenter', show); b.addEventListener('mouseleave', hide)
  // From the keyboard only: a clicked pin keeps focus, and its tip would stay over the picture.
  b.addEventListener('focus', () => { if (b.matches(':focus-visible')) show() }); b.addEventListener('blur', hide)
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
    const n = ++replies
    try { scoreFrom(n)((await api('/api/missed', { remove: m.id })).score); view.missed = view.missed.filter((x) => x !== m); drawPins(view); focusNext(view) }
    catch (err) { say("Couldn't remove that. " + err.message, true) }
  })
  return b
}

function closeAdd(refocus) {
  if (!adding) return
  const view = adding.view
  adding.box.remove(); adding.mark.remove(); adding = null
  if (refocus) focusNext(view)
}

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
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeAdd(true) }
    // A select doesn't submit its form on Enter by itself.
    if (e.key === 'Enter' && e.target === sel) { e.preventDefault(); box.requestSubmit() }
  })
  box.lastChild.addEventListener('click', () => closeAdd(true))
  let saving = false
  box.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (saving) return
    saving = true
    const n = ++replies
    try {
      const r = await api('/api/missed', { lookId: view.lookId, kind: sel.value, x, y })
      view.missed.push({ id: r.id, kind: sel.value, x, y }); scoreFrom(n)(r.score); closeAdd(); drawPins(view); focusNext(view)
    } catch (err) { saving = false; say("Couldn't add that. " + err.message, true) }
  })
  pic.append(mark, box); adding = { box, mark, view }; sel.focus()
}

/** Just the pins of one view: the picture itself stays as it is. */
function drawPins(view) {
  view.pic.querySelectorAll('.pin,.tip').forEach((n) => n.remove())
  for (const p of view.pins) view.pic.append(pinFor(p))
  for (const m of view.missed) view.pic.append(missedPin(view, m))
}

const headText = (v) => ' · ' + v.pins.filter((p) => p.verdict).length + ' of ' + plural(v.pins.length, 'pin', 'pins') + ' marked'

function drawSpot() {
  const box = document.getElementById('spot'); box.replaceChildren()
  const s = current
  const v0 = s.views.find((v) => v.water)
  const prev = el('button', { textContent: '← Previous', disabled: s.prev == null }), next = el('button', { textContent: 'Next →', disabled: s.next == null })
  prev.addEventListener('click', () => go(s.prev)); next.addEventListener('click', () => go(s.next))
  box.append(el('div', { className: 'spothead' },
    el('strong', { textContent: s.clip + ' at ' + clock(s.ft) }),
    el('span', { className: 'chip num', textContent: 'spots every ' + (100 / 2 ** s.level) + ' m' }),
    v0 && el('span', { className: 'chip', textContent: 'water: ' + v0.water }),
    v0 && el('span', { className: 'chip', textContent: 'light: ' + v0.light }),
    s.cameraYaw == null && el('span', { className: 'chip', title: 'The camera direction isn\\'t known for this clip yet, so ahead and behind may be swapped.', textContent: 'camera direction assumed' }),
    prev, next))
  const grid = el('div', { className: 'views' })
  for (const v of s.views) {
    const pic = el('div', { className: 'pic' + (v.lookId ? ' can-add' : '') }, el('div', { className: 'wait', textContent: 'Cutting the picture…' }))
    const img = el('img', { alt: v.name + ' view', src: '/view/' + s.id + '/' + v.viewYaw + '.jpg' })
    img.addEventListener('load', () => pic.querySelector('.wait')?.remove())
    img.addEventListener('error', () => { const w = pic.querySelector('.wait'); if (w) w.textContent = "Couldn't cut this picture. Check the clip is still on this machine, or see the terminal." })
    pic.prepend(img)
    v.pic = pic
    if (v.lookId) pic.addEventListener('click', (e) => { const r = pic.getBoundingClientRect(); addBox(v, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height) })
    v.head = el('span', { className: 'num', textContent: headText(v) })
    grid.append(el('div', { className: 'view' }, el('h3', {}, el('b', { textContent: v.name[0].toUpperCase() + v.name.slice(1) }), v.head),
      pic, el('p', { className: 'scene', textContent: v.ok ? v.scene : v.lookId ? 'The model gave no usable answer here.' : 'Not looked at yet.' })))
    drawPins(v)
  }
  box.append(grid)
  if (s.others.length) {
    const o = el('div', { className: 'others' })
    for (const x of s.others) { const b = el('button', { textContent: x.clip + (x.day ? ' · ' + x.day : '') + ' · ' + x.metres + ' m away' }); b.addEventListener('click', () => go(x.id)); o.append(b) }
    box.append(el('div', { className: 'card', style: 'margin-top:16px' }, el('h2', { textContent: 'Same place, other days' }), o))
  }
}

async function markRestRight() {
  if (busy) return
  const s = current, pins = s.views.flatMap((v) => v.pins).filter((p) => !p.verdict)
  if (!pins.length) return say('Nothing left to mark here.')
  busy = true
  const n = ++replies
  try {
    const r = await api('/api/review', { itemIds: pins.map((p) => p.id), verdict: 'right' })
    for (const p of pins) if (r.saved.includes(p.id)) p.verdict = 'right'
    updateChecked(s.id, s.views); scoreFrom(n)(r.score)
    if (current === s) { for (const v of s.views) drawPins(v); focusNext() }
    say('Marked ' + plural(r.saved.length, 'pin', 'pins') + ' right. Click one to change it.')
  } catch (e) { say("Couldn't save those marks. " + e.message, true) }
  finally { busy = false }
}

document.addEventListener('click', (e) => { if (adding && !adding.box.contains(e.target)) closeAdd() }, true)
document.addEventListener('keydown', (e) => {
  if (!current || e.target.closest?.('select,input,.add') || e.metaKey || e.ctrlKey || e.altKey) return
  const atEnd = () => say('End of this clip. Press n for the next unmarked spot.')
  if (e.key === 'Escape') closeAdd(true)
  else if (e.key === 'ArrowLeft') current.prev != null ? go(current.prev) : atEnd()
  else if (e.key === 'ArrowRight') current.next != null ? go(current.next) : atEnd()
  else if (e.key === 'n') { const nxt = nextUnmarked(); nxt ? go(nxt.id) : say('No other spot has unmarked pins.') }
  else if ((e.key === 'A' || (e.key === 'a' && e.shiftKey)) && !e.repeat) markRestRight()
})

// ---------- areas: drawn on the map, looked at carefully by course:look --areas ----------

const LOOK_AREAS = 'pnpm --filter web course:look --areas'
let MIN_A_SPOT = 5 // a careful look is 8 views at about 36 s each; measured once there are some (/api/areas)

function drawAreas() {
  const card = document.getElementById('areas'); card.replaceChildren(el('h2', { textContent: 'Areas to look at carefully' }))
  if (!areas.length) {
    card.append(el('p', { className: 'help', textContent: 'None yet. The model looks closely every 25 m inside an area, on every day you paddled there, for things that identify the place.' }))
    return
  }
  const list = el('div', { className: 'arealist' })
  for (const a of areas) {
    const open = el('button', { ariaLabel: 'Show what was found in ' + a.name },
      el('span', { textContent: a.name + ' · ' + areaSize(a) }), el('small', { textContent: a.looked + ' of ' + plural(a.spots, 'spot', 'spots') + ' looked at · ' + plural(a.found, 'thing', 'things') + ' found' }))
    open.addEventListener('click', () => showArea(a.id))
    const rm = el('button', { textContent: '×', ariaLabel: 'Remove the area ' + a.name, title: 'Remove this area (what was found stays in the store)' })
    rm.addEventListener('click', async () => {
      try {
        areas = (await api('/api/area', { remove: a.id })).areas
        if (openArea && openArea.id === a.id) go(lastSpot ?? all[0]?.id)
        drawAreas(); drawMap()
        // What it found stays with its spots, so drawing it again brings it all back.
        sayUndo('Removed ' + a.name + '.', async () => {
          try { const r = await api('/api/area', { name: a.name, south: a.south, west: a.west, north: a.north, east: a.east }); areas = r.areas; drawAreas(); drawMap(); say('') }
          catch (e) { say("Couldn't put it back. " + e.message, true) }
        })
      } catch (e) { say("Couldn't remove that area. " + e.message, true) }
    })
    list.append(el('div', { className: 'row' }, open, rm))
  }
  card.append(list)
  const left = areas.reduce((n, a) => n + a.spots - a.looked, 0)
  if (left) card.append(el('p', { className: 'help', style: 'margin-top:8px', textContent: plural(left, 'spot', 'spots') + ' still to look at (about ' + hours(left * MIN_A_SPOT) + '), in the order the areas were drawn. Run this in a terminal; this page can stay open. Press Reload on an area to see new finds.' }), el('code', { className: 'cmd', textContent: LOOK_AREAS }))
}

const areaSize = (a) => Math.round((a.east - a.west) * Math.cos(a.south * Math.PI / 180) * 111320) + ' × ' + Math.round((a.north - a.south) * 111320) + ' m'
const hours = (min) => min < 90 ? Math.round(min) + ' min' : min < 48 * 60 ? (min / 60).toFixed(1) + ' h' : Math.round(min / 1440) + ' days'

/** A status line with an Undo button. */
function sayUndo(text, undo) {
  say(text)
  const b = el('button', { textContent: 'Undo' })
  b.addEventListener('click', undo, { once: true })
  document.getElementById('status').append(b)
}

/** Press and drag on the map to draw an area; a press that hardly moves is still a click on a spot. */
function mapDrawing() {
  const svg = document.getElementById('map')
  let start = null, from = null, drew = false, pan = null
  const at = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()) }
  const place = (a, b) => { for (const [k, v] of Object.entries({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) })) drawingArea.setAttribute(k, v) }
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !mapProj) return
    // Shift-drag moves a zoomed map instead of drawing.
    if (e.shiftKey && mapZoom.z > 1) { pan = { x: e.clientX, y: e.clientY, z: { ...mapZoom } }; svg.setPointerCapture(e.pointerId); drew = true; return }
    start = at(e); from = [e.clientX, e.clientY]; drew = false
  })
  svg.addEventListener('pointermove', (e) => {
    // A press that left the map before it became a drag, released outside: forget it.
    if (!(e.buttons & 1)) { if (start && !drew) start = null; if (!pan) return }
    if (pan) {
      const per = (300 / pan.z.z) / svg.clientWidth
      mapZoom = { ...pan.z, x: Math.min(Math.max(pan.z.x - (e.clientX - pan.x) * per, 0), 300 - 300 / pan.z.z), y: Math.min(Math.max(pan.z.y - (e.clientY - pan.y) * per, 0), mapH - mapH / pan.z.z) }
      return drawMap()
    }
    if (!start) return
    if (!drew) {
      if (Math.hypot(e.clientX - from[0], e.clientY - from[1]) < 6) return
      drew = true; closeAreaForm()
      svg.setPointerCapture(e.pointerId)
      drawingArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); drawingArea.setAttribute('class', 'area open'); svg.append(drawingArea)
    }
    place(start, at(e))
  })
  const end = (e, cancelled) => {
    if (pan) { pan = null; return }
    if (!start) return
    const a = start; start = null
    if (!drew) return
    const b = at(e)
    if (cancelled || Math.abs(b.x - a.x) < 4 || Math.abs(b.y - a.y) < 4) { drawingArea.remove(); drawingArea = null; return }
    nameArea(mapProj.toLatLng(a.x, a.y), mapProj.toLatLng(b.x, b.y))
  }
  svg.addEventListener('pointerup', (e) => end(e, false))
  svg.addEventListener('pointercancel', (e) => end(e, true))
  // The click that ends a drag isn't a click on a spot.
  svg.addEventListener('click', (e) => { if (drew) { e.stopPropagation(); drew = false } }, true)
}

function closeAreaForm() {
  document.getElementById('areaform').replaceChildren()
  if (drawingArea) { drawingArea.remove(); drawingArea = null }
}

function nameArea(p, q) {
  const box = document.getElementById('areaform')
  const corners = { south: Math.min(p.lat, q.lat), north: Math.max(p.lat, q.lat), west: Math.min(p.lng, q.lng), east: Math.max(p.lng, q.lng) }
  const input = el('input', { type: 'text', maxLength: 60, placeholder: "Name it, e.g. Fry's Island", ariaLabel: 'Name of the area' })
  const est = el('span', { className: 'est', textContent: areaSize(corners) + ' · counting spots…' })
  const form = el('form', { className: 'areaform' }, input, el('button', { type: 'submit', textContent: 'Save' }), el('button', { type: 'button', textContent: '×', ariaLabel: 'Cancel' }), est)
  form.querySelector('button[type=button]').addEventListener('click', closeAreaForm)
  // What it would take, before it's saved: a big area holds up every area drawn after it.
  api('/api/area-spots?s=' + corners.south + '&w=' + corners.west + '&n=' + corners.north + '&e=' + corners.east).then((r) => {
    const min = r.spots * MIN_A_SPOT
    est.textContent = areaSize(corners) + ' · ' + (r.spots ? plural(r.spots, 'spot', 'spots') + ' on all your passes, about ' + hours(min) : 'no footage passes through it')
    if (min > 10 * 60) { est.classList.add('big'); est.textContent += ". That's a lot: zoom in and draw a smaller one?" }
  }).catch(() => { est.textContent = areaSize(corners) })
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAreaForm() } })
  let saving = false
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const name = input.value.trim()
    if (!name) return input.focus()
    if (saving) return
    saving = true
    try {
      const r = await api('/api/area', { name, ...corners })
      areas = r.areas; closeAreaForm(); drawAreas(); showArea(r.id)
    } catch (err) { saving = false; say("Couldn't save that area. " + err.message, true) }
  })
  box.replaceChildren(form); input.focus()
}

/** What the careful look found in an area: each thing on the closer view it was seen in, boxed. */
async function showArea(id) {
  const mine = ++seq
  closeAdd(); say('')
  let a
  try { a = await api('/api/area/' + id) } catch (e) { if (mine === seq) say(e.message, true); return }
  if (mine !== seq) return
  if (current) lastSpot = current.id
  const back = lastSpot ?? all[0]?.id
  openArea = a; current = null
  // The list's progress too, so it agrees with this area.
  api('/api/areas').then((r) => { areas = r.areas; MIN_A_SPOT = r.minutesASpot; drawAreas() }).catch(() => {})
  history.replaceState(null, '', '#area-' + id)
  drawMap()
  const box = document.getElementById('spot'); box.replaceChildren()
  const toSpots = el('button', { textContent: '← All spots', disabled: back == null })
  toSpots.addEventListener('click', () => go(back))
  const again = el('button', { textContent: 'Reload' }); again.addEventListener('click', () => showArea(id))
  box.append(el('div', { className: 'spothead' }, el('strong', { textContent: a.name }),
    el('span', { className: 'chip num', textContent: a.looked + ' of ' + plural(a.spots, 'spot', 'spots') + ' looked at' }),
    el('span', { className: 'chip num', textContent: plural(a.things.length, 'thing', 'things') + ' found' }), toSpots, again))
  if (document.activeElement === document.body) toSpots.focus({ preventScroll: true })
  if (!a.things.length) {
    const why = !a.spots ? 'No footage passes through this area. Draw it over the river on the map.'
      : !a.looked ? 'Nothing looked at here yet. It takes about ' + hours(a.spots * MIN_A_SPOT) + ' for this area. Run this in a terminal, then reload:'
      : 'Nothing found yet in the ' + plural(a.looked, 'spot', 'spots') + ' looked at.'
    box.append(el('div', { className: 'empty' }, el('p', { textContent: why }), a.spots && !a.looked ? el('code', { className: 'cmd', textContent: LOOK_AREAS }) : null))
    return
  }
  const grid = el('div', { className: 'finds' })
  for (const t of a.things) {
    const pic = el('div', { className: 'pic', style: 'cursor:default' }, el('div', { className: 'wait', textContent: 'Cutting the picture…' }))
    const img = el('img', { alt: t.name, loading: 'lazy', draggable: false, src: '/view/' + t.stationId + '/l' + t.viewYaw + '.jpg' })
    img.addEventListener('load', () => pic.querySelector('.wait')?.remove())
    img.addEventListener('error', () => { const w = pic.querySelector('.wait'); if (w) w.textContent = "Couldn't cut this picture. Check the clip is still on this machine." })
    const b = el('div', { className: 'box' })
    b.style.left = (t.box.x0 * 100) + '%'; b.style.top = (t.box.y0 * 100) + '%'; b.style.width = ((t.box.x1 - t.box.x0) * 100) + '%'; b.style.height = ((t.box.y1 - t.box.y0) * 100) + '%'
    pic.prepend(img); pic.append(b)
    const meta = el('div', { className: 'meta' }, el('span', { className: 'num', textContent: t.clip + (t.day ? ' · ' + t.day : '') + ' · ' + clock(t.ft) }))
    if (all.some((s) => s.id === t.stationId)) { const o = el('button', { textContent: 'Open spot' }); o.addEventListener('click', () => go(t.stationId)); meta.append(o) }
    else meta.append(el('span', { textContent: '· between the spots of the general look' }))
    grid.append(el('div', { className: 'find' }, pic,
      el('h3', {}, el('span', { textContent: t.name }), el('span', { className: 'chip', textContent: t.kind }), el('span', { className: t.sure ? 'sure' : 'maybe', textContent: t.sure ? 'sure' : 'not sure' })),
      el('p', { textContent: t.detail }), meta))
  }
  box.append(grid)
}

mapDrawing()

/** Scroll on the map to zoom in and out round the pointer. */
document.getElementById('map').addEventListener('wheel', (e) => {
  if (!mapProj) return
  const svg = e.currentTarget, p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY
  const at = p.matrixTransform(svg.getScreenCTM().inverse())
    // By how far it was scrolled: a wheel click or a trackpad's many small steps.
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)
  const was = mapZoom.z, z = Math.min(Math.max(was * Math.exp(-dy * 0.002), 1), 80)
  // Fully out or fully in: let the page scroll.
  if (z === was) return
  e.preventDefault()
  const vx = mapZoom.z === 1 ? 0 : mapZoom.x, vy = mapZoom.z === 1 ? 0 : mapZoom.y
  // Keep the point under the pointer where it is, and the view inside the map.
  const x = Math.min(Math.max(at.x - (at.x - vx) * was / z, 0), 300 - 300 / z), y = Math.min(Math.max(at.y - (at.y - vy) * was / z, 0), mapH - mapH / z)
  mapZoom = z === 1 ? { z: 1, x: 0, y: 0 } : { z, x, y }
  drawMap()
}, { passive: false })
document.getElementById('unzoom').addEventListener('click', () => { mapZoom = { z: 1, x: 0, y: 0 }; drawMap() })
let bigMap = false
try { bigMap = localStorage.getItem('explore.bigMap') === '1' } catch {}
const setBigMap = (on) => {
  bigMap = on; document.body.classList.toggle('bigmap', on)
  document.getElementById('bigger').textContent = on ? 'Smaller map' : 'Bigger map'
  try { localStorage.setItem('explore.bigMap', on ? '1' : '0') } catch {}
  drawMap()
}
setBigMap(bigMap)
document.getElementById('bigger').addEventListener('click', () => setBigMap(!bigMap))

let resizing
// Lay the pins out again when the pictures change size.
addEventListener('resize', () => { clearTimeout(resizing); resizing = setTimeout(() => { const before = picW; if (current && Math.abs(measurePic() - before) >= 20) go(current.id) }, 300) })

;(async () => {
  const d = await api('/api/spots')
  all = d.spots; tracks = d.tracks
  const ar = await api('/api/areas')
  areas = ar.areas; MIN_A_SPOT = ar.minutesASpot
  drawAreas()
  document.getElementById('model').textContent = '· ' + d.model + ' · ' + plural(all.length, 'spot', 'spots')
  drawScore(await api('/api/score'))
  const areaHash = /^#area-([0-9]+)$/.exec(location.hash)
  if (areaHash && areas.some((a) => a.id === Number(areaHash[1]))) return showArea(Number(areaHash[1]))
  if (!all.length) { drawMap(); document.getElementById('spot').replaceChildren(el('div', { className: 'empty', textContent: 'Nothing to explore yet for this model. Run pnpm --filter web course:look first, start course:explore with the --model it used, or draw an area on the map to look at carefully.' })); return }
  const fromHash = Number(location.hash.slice(1))
  await go(all.some((s) => s.id === fromHash) ? fromHash : all[0].id)
})().catch((e) => { document.getElementById('spot').replaceChildren(el('div', { className: 'empty', textContent: "Couldn't load the spots. " + e.message })) })
</script>
</body></html>`
