// The River Explorer page (course:explore). One file, no libraries, nothing
// fetched from anywhere but the local server. The model's words are put on the
// page as text, never as HTML.
export const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>River Explorer</title>
<style>
:root{--bg:#0b1220;--surface:#0f172a;--surface2:#1e293b;--border:#1e293b;--fg:#e2e8f0;--muted:#94a3b8;--primary:#38bdf8;--green:#22c55e;--red:#f87171;--amber:#fbbf24}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 "IBM Plex Mono",ui-monospace,Menlo,monospace}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)}
h1{font-size:15px;margin:0;letter-spacing:.08em}
h1 small{color:var(--muted);font-weight:400;letter-spacing:0}
.score{display:flex;gap:18px;align-items:baseline;flex-wrap:wrap}
.score b{font-size:22px;color:var(--primary)}
.muted{color:var(--muted)}
main{display:grid;grid-template-columns:300px 1fr;gap:16px;padding:16px}
@media (max-width:900px){main{grid-template-columns:1fr}}
aside{display:flex;flex-direction:column;gap:16px}
.card{background:var(--surface);border:1px solid var(--border);padding:12px}
.card h2{font-size:11px;letter-spacing:.1em;color:var(--muted);margin:0 0 8px;font-weight:500}
svg#map{width:100%;height:auto;display:block;background:var(--bg)}
#map circle{cursor:pointer}
.kinds div{display:grid;grid-template-columns:1fr 90px 40px;gap:8px;align-items:center;margin:3px 0}
.bar{height:6px;background:var(--surface2);position:relative}.bar i{position:absolute;inset:0 auto 0 0;background:var(--green)}
.spothead{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;margin-bottom:12px}
.spothead strong{font-size:14px}
.chip{border:1px solid var(--border);padding:2px 8px;color:var(--muted)}
button{font:inherit;color:var(--fg);background:var(--surface2);border:1px solid var(--border);padding:8px 12px;min-height:36px;cursor:pointer}
button:hover:not(:disabled){border-color:var(--primary)}button:disabled{opacity:.35;cursor:default}
.views{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
@media (min-width:1700px){.views{grid-template-columns:repeat(4,1fr)}}
@media (max-width:600px){.views{grid-template-columns:1fr}}
.view h3{font-size:11px;letter-spacing:.1em;margin:0 0 4px;color:var(--muted);font-weight:500}
.view h3 b{color:var(--fg)}
.pic{position:relative;aspect-ratio:1024/640;background:var(--surface2);cursor:crosshair}
.pic img{width:100%;height:100%;object-fit:cover;display:block}
.pic .wait{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted)}
.pin{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;gap:4px;padding:2px 6px 2px 4px;background:rgba(11,18,32,.82);border:1px solid var(--primary);color:var(--fg);font-size:11px;cursor:pointer;white-space:nowrap;min-height:0}
.pin::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--primary)}
.pin.right{border-color:var(--green)}.pin.right::before{background:var(--green)}
.pin.wrong{border-color:var(--red);text-decoration:line-through;opacity:.8}.pin.wrong::before{background:var(--red)}
.pin.missed{border:1px dashed var(--amber)}.pin.missed::before{background:var(--amber)}
.pin:focus-visible,.pin:hover{z-index:2;outline:2px solid var(--fg)}
.tip{position:absolute;z-index:3;left:0;right:0;bottom:0;padding:6px 8px;background:rgba(11,18,32,.92);font-size:12px;pointer-events:none}
.scene{color:var(--muted);margin:6px 0 0;min-height:2.9em}
.add{position:absolute;z-index:4;background:var(--surface);border:1px solid var(--amber);padding:6px;display:flex;gap:4px}
.add select{font:inherit;background:var(--surface2);color:var(--fg);border:1px solid var(--border);min-height:32px}
.others{display:flex;flex-wrap:wrap;gap:8px}
.help{color:var(--muted);font-size:12px}
.help kbd{border:1px solid var(--border);padding:0 4px;color:var(--fg)}
.empty{padding:48px 16px;text-align:center;color:var(--muted)}
</style></head>
<body>
<header>
  <h1>RIVER EXPLORER <small id="model"></small></h1>
  <div class="score" id="score"></div>
</header>
<main>
  <aside>
    <div class="card"><h2>WHERE</h2><svg id="map" viewBox="0 0 300 300" role="img" aria-label="Map of the spots looked at"></svg>
      <p class="help"><span style="color:var(--green)">●</span> checked &nbsp;<span style="color:var(--primary)">●</span> not yet</p></div>
    <div class="card kinds" id="kinds"><h2>RIGHT BY KIND</h2><p class="help">Mark a few pins to see how the model does on each kind of thing.</p></div>
    <div class="card help">
      <h2>HOW</h2>
      Click a pin: <span style="color:var(--green)">right</span>, again: <span style="color:var(--red)">made up</span>, again: clear.<br>
      Click the picture where the model missed something to add it.<br>
      <kbd>←</kbd> <kbd>→</kbd> along the clip &nbsp;<kbd>n</kbd> next spot to check &nbsp;<kbd>a</kbd> the rest of this spot are right
    </div>
  </aside>
  <section id="spot"><div class="empty">Loading…</div></section>
</main>
<script>
const KINDS = __KINDS__
let all = [], current = null, adding = null
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) if (k != null && k !== false) e.append(k); return e }
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText)
  return r.json()
}
const pct = (r) => r == null ? '–' : Math.round(r * 100) + '%'
const clock = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')

function drawScore(s) {
  const box = document.getElementById('score'); box.replaceChildren()
  box.append(el('span', {}, el('b', { textContent: pct(s.rate) }), ' right'),
    el('span', { className: 'muted', textContent: s.checked + ' checked · ' + s.wrong + ' made up · ' + s.missed + ' missed' }))
  const k = document.getElementById('kinds'); k.replaceChildren(el('h2', { textContent: 'RIGHT BY KIND' }))
  if (!s.byKind.length) k.append(el('p', { className: 'help', textContent: 'Mark a few pins to see how the model does on each kind of thing.' }))
  for (const r of s.byKind.slice(0, 12)) {
    const bar = el('div', { className: 'bar' }, el('i', { style: 'width:' + Math.round(r.rate * 100) + '%' }))
    k.append(el('div', {}, el('span', { textContent: r.kind }), bar, el('span', { className: 'muted', textContent: (r.right) + '/' + (r.right + r.wrong) })))
  }
}

function drawMap() {
  const svg = document.getElementById('map'); svg.replaceChildren()
  if (!all.length) return
  const lat0 = all.reduce((a, s) => a + s.lat, 0) / all.length, k = Math.cos(lat0 * Math.PI / 180)
  const pts = all.map((s) => [s.lng * k, -s.lat]).concat(window.tracks.flat().map(([la, ln]) => [ln * k, -la]))
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const sc = 280 / Math.max(x1 - x0, y1 - y0, 1e-6)
  const P = (lat, lng) => [10 + (lng * k - x0) * sc, 10 + (-lat - y0) * sc]
  const ns = 'http://www.w3.org/2000/svg'
  for (const t of window.tracks) {
    const pl = document.createElementNS(ns, 'polyline')
    pl.setAttribute('points', t.map(([la, ln]) => P(la, ln).join(',')).join(' '))
    pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', '#1e293b'); pl.setAttribute('stroke-width', '2')
    svg.append(pl)
  }
  for (const s of all) {
    const c = document.createElementNS(ns, 'circle'), [x, y] = P(s.lat, s.lng)
    c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', current && s.id === current.id ? 6 : 3.5)
    c.setAttribute('fill', s.checked >= s.things && s.things ? '#22c55e' : '#38bdf8')
    if (current && s.id === current.id) { c.setAttribute('stroke', '#e2e8f0'); c.setAttribute('stroke-width', '2') }
    const t = document.createElementNS(ns, 'title'); t.textContent = s.clip + ' ' + clock(s.ft) + ' · ' + s.things + ' things'; c.append(t)
    c.addEventListener('click', () => go(s.id))
    svg.append(c)
  }
}

async function go(id) {
  adding = null
  current = await api('/api/spot/' + id)
  history.replaceState(null, '', '#' + id)
  drawSpot(); drawMap()
}

function pinFor(view, p) {
  const b = el('button', { className: 'pin' + (p.verdict ? ' ' + p.verdict : ''), textContent: p.kind + (p.count > 1 ? ' ×' + p.count : ''),
    title: p.detail, ariaLabel: p.kind + ': ' + p.detail + (p.verdict ? ' (' + p.verdict + ')' : '') })
  b.style.left = (p.px * 100) + '%'; b.style.top = (p.py * 100) + '%'
  const tip = el('div', { className: 'tip', textContent: p.kind + ' · ' + p.distance + ' · ' + p.detail })
  b.addEventListener('mouseenter', () => b.parentElement.append(tip)); b.addEventListener('mouseleave', () => tip.remove())
  b.addEventListener('focus', () => b.parentElement.append(tip)); b.addEventListener('blur', () => tip.remove())
  b.addEventListener('click', async (e) => {
    e.stopPropagation()
    const next = p.verdict == null ? 'right' : p.verdict === 'right' ? 'wrong' : null
    drawScore(await api('/api/review', { itemId: p.id, verdict: next }))
    p.verdict = next; b.className = 'pin' + (next ? ' ' + next : '')
    countChecked()
  })
  return b
}

function countChecked() {
  const s = all.find((x) => x.id === current.id)
  if (s) { s.checked = current.views.flatMap((v) => v.pins).filter((p) => p.verdict).length; drawMap() }
}

function missedPin(view, m) {
  const b = el('button', { className: 'pin missed', textContent: m.kind, title: 'You added this. Click to remove it.' })
  b.style.left = (m.x * 100) + '%'; b.style.top = '86%'
  b.addEventListener('click', async (e) => { e.stopPropagation(); drawScore((await api('/api/missed', { remove: m.id })).score); view.missed = view.missed.filter((x) => x !== m); drawSpot() })
  return b
}

function addBox(view, pic, x, y) {
  adding?.remove()
  const sel = el('select', { ariaLabel: 'What did it miss?' }, ...KINDS.map((k) => el('option', { value: k, textContent: k })))
  const ok = el('button', { textContent: 'Add' }), no = el('button', { textContent: '×', ariaLabel: 'Cancel' })
  const box = el('div', { className: 'add' }, sel, ok, no)
  box.style.left = Math.min(x * 100, 55) + '%'; box.style.top = Math.min(y * 100, 75) + '%'
  box.addEventListener('click', (e) => e.stopPropagation())
  no.addEventListener('click', () => { box.remove(); adding = null })
  ok.addEventListener('click', async () => {
    const r = await api('/api/missed', { lookId: view.lookId, kind: sel.value, x })
    view.missed.push({ id: r.id, kind: sel.value, x }); drawScore(r.score); drawSpot()
  })
  pic.append(box); adding = box; sel.focus()
}

function drawSpot() {
  const box = document.getElementById('spot'); box.replaceChildren()
  const s = current
  const v0 = s.views.find((v) => v.water)
  const head = el('div', { className: 'spothead' },
    el('strong', { textContent: s.clip + ' at ' + clock(s.ft) }),
    el('span', { className: 'chip', textContent: 'every ' + (100 / 2 ** s.level) + ' m' }),
    v0 && el('span', { className: 'chip', textContent: 'water: ' + v0.water }),
    v0 && el('span', { className: 'chip', textContent: 'light: ' + v0.light }),
    s.cameraYaw == null && el('span', { className: 'chip', title: 'The camera direction is not known yet for this clip, so ahead and behind may be swapped', textContent: 'camera direction assumed' }))
  const prev = el('button', { textContent: '← back', disabled: s.prev == null }), next = el('button', { textContent: 'on →', disabled: s.next == null })
  prev.addEventListener('click', () => go(s.prev)); next.addEventListener('click', () => go(s.next))
  head.append(prev, next)
  box.append(head)
  const grid = el('div', { className: 'views' })
  for (const v of s.views) {
    const pic = el('div', { className: 'pic' }, el('div', { className: 'wait', textContent: 'cutting the picture…' }))
    const img = el('img', { alt: v.name + ' view', src: '/view/' + s.id + '/' + v.viewYaw + '.jpg' })
    img.addEventListener('load', () => pic.querySelector('.wait')?.remove())
    img.addEventListener('error', () => { const w = pic.querySelector('.wait'); if (w) w.textContent = 'the clip is not on this machine' })
    pic.prepend(img)
    for (const p of v.pins) pic.append(pinFor(v, p))
    for (const m of v.missed) pic.append(missedPin(v, m))
    if (v.lookId) pic.addEventListener('click', (e) => { const r = pic.getBoundingClientRect(); addBox(v, pic, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height) })
    grid.append(el('div', { className: 'view' },
      el('h3', {}, el('b', { textContent: v.name.toUpperCase() }), ' · ' + v.pins.length + ' things'),
      pic, el('p', { className: 'scene', textContent: v.ok ? v.scene : v.lookId ? 'The model gave no usable answer here.' : 'Not looked at yet.' })))
  }
  box.append(grid)
  if (s.others.length) {
    const o = el('div', { className: 'others' })
    for (const x of s.others) { const b = el('button', { textContent: x.clip + (x.startUtc ? ' · ' + x.startUtc.slice(0, 10) : '') + ' · ' + x.metres + ' m away' }); b.addEventListener('click', () => go(x.id)); o.append(b) }
    box.append(el('div', { className: 'card', style: 'margin-top:16px' }, el('h2', { textContent: 'THE SAME PLACE ON OTHER DAYS' }), o))
  }
}

document.addEventListener('keydown', async (e) => {
  if (!current || e.target.closest?.('select,.add') || e.metaKey || e.ctrlKey) return
  if (e.key === 'ArrowLeft' && current.prev != null) go(current.prev)
  if (e.key === 'ArrowRight' && current.next != null) go(current.next)
  if (e.key === 'n') {
    const i = all.findIndex((s) => s.id === current.id)
    const nxt = [...all.slice(i + 1), ...all.slice(0, i)].find((s) => s.things && s.checked < s.things)
    if (nxt) go(nxt.id)
  }
  if (e.key === 'a') {
    for (const p of current.views.flatMap((v) => v.pins).filter((p) => !p.verdict)) { drawScore(await api('/api/review', { itemId: p.id, verdict: 'right' })); p.verdict = 'right' }
    drawSpot(); countChecked()
  }
  if (e.key === 'Escape') { adding?.remove(); adding = null }
})

;(async () => {
  const d = await api('/api/spots')
  all = d.spots; window.tracks = d.tracks
  document.getElementById('model').textContent = '· ' + d.model + ' · ' + all.length + ' spots'
  drawScore(await api('/api/score'))
  if (!all.length) { document.getElementById('spot').replaceChildren(el('div', { className: 'empty', textContent: 'Nothing to explore yet. Run pnpm --filter web course:look first.' })); drawMap(); return }
  const fromHash = Number(location.hash.slice(1))
  go(all.some((s) => s.id === fromHash) ? fromHash : all[0].id)
})().catch((e) => { document.getElementById('spot').replaceChildren(el('div', { className: 'empty', textContent: 'Could not load: ' + e.message })) })
</script>
</body></html>`
