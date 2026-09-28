import { SCREENS, shown, type ScreenEl, type ScreenFont, type ScreenName, type TrackerScreen as Screen } from '@/lib/tracker-screens'

// One of the tracker's screens, drawn at the panel's own 128x64 coordinates.
// The drawings live in lib/tracker-screens.ts (tested against the firmware);
// this only paints them. White on black like the real panel, whatever the site
// theme, because that is what the tracker looks like.

const INK = '#eef4ff'
const PANEL = '#000'

const FONT: Record<ScreenFont, { size: number; family: string; weight: number }> = {
  s: { size: 8, family: 'ui-monospace, Menlo, monospace', weight: 400 },
  m: { size: 10, family: 'ui-monospace, Menlo, monospace', weight: 400 },
  l: { size: 14, family: 'Helvetica, Arial, sans-serif', weight: 700 },
  code: { size: 27, family: 'Helvetica, Arial, sans-serif', weight: 700 },
  xl: { size: 32, family: 'Helvetica, Arial, sans-serif', weight: 700 },
}

// A stand-in for a QR code: the three corner squares and a fixed scatter of
// modules. It is deliberately not a real code, so nobody scans the guide.
function FakeQr({ x, y, size }: { x: number; y: number; size: number }) {
  const n = 21
  const m = size / n
  const cells: [number, number][] = []
  const finder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (finder(r, c)) {
        const rr = r >= n - 7 ? r - (n - 7) : r
        const cc = c >= n - 7 ? c - (n - 7) : c
        const ring = rr === 0 || rr === 6 || cc === 0 || cc === 6
        const core = rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4
        if (ring || core) cells.push([r, c])
      } else if (((r * 7 + c * 13 + r * c) % 5) < 2) {
        cells.push([r, c])
      }
    }
  }
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} fill={INK} />
      {cells.map(([r, c]) => <rect key={`${r}-${c}`} x={x + c * m} y={y + r * m} width={m} height={m} fill={PANEL} />)}
    </g>
  )
}

function Battery({ x, pct }: { x: number; pct: number }) {
  return (
    <g>
      <rect x={x + 0.5} y={0.5} width={13} height={7} fill="none" stroke={INK} />
      <rect x={x + 14} y={2} width={2} height={4} fill={INK} />
      <rect x={x + 2} y={2} width={(pct * 10) / 100} height={4} fill={INK} />
    </g>
  )
}

function El({ e }: { e: ScreenEl }) {
  if ('text' in e) {
    const f = FONT[e.font]
    return (
      <text
        x={e.x} y={e.y}
        fill={e.invert ? PANEL : INK}
        fontSize={f.size} fontFamily={f.family} fontWeight={f.weight}
        textAnchor={e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'}
        xmlSpace="preserve"
      >
        {shown(e.text)}
      </text>
    )
  }
  if ('hline' in e) return <rect x={0} y={e.hline} width={128} height={1} fill={INK} />
  if ('box' in e) { const [x, y, w, h] = e.box; return <rect x={x} y={y} width={w} height={h} fill={INK} /> }
  if ('frame' in e) { const [x, y, w, h] = e.frame; return <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} fill="none" stroke={INK} /> }
  if ('disc' in e) { const [x, y, r] = e.disc; return <circle cx={x} cy={y} r={r} fill={e.filled ? INK : 'none'} stroke={INK} strokeWidth={e.filled ? 0 : 1} /> }
  if ('qr' in e) { const [x, y, s] = e.qr; return <FakeQr x={x} y={y} size={s} /> }
  if ('battery' in e) return <Battery x={112} pct={e.battery} />
  // The Track screen's status row: satellite (faint while searching), signal
  // bars, battery percentage and gauge, and the rule under them.
  const { fix, bars, pct } = e.topRow
  return (
    <g>
      <g opacity={fix ? 1 : 0.45}>
        <rect x={3} y={2} width={5} height={4} fill={INK} />
        <rect x={0} y={3} width={2} height={2} fill={INK} />
        <rect x={9} y={3} width={2} height={2} fill={INK} />
      </g>
      {Array.from({ length: 5 }, (_, i) => {
        const h = 2 + i * 2
        return i < bars
          ? <rect key={i} x={15 + i * 4} y={8 - h} width={3} height={h} fill={INK} />
          : <rect key={i} x={15 + i * 4} y={7} width={3} height={1} fill={INK} />
      })}
      <text x={109} y={7} fill={INK} fontSize={8} fontFamily={FONT.s.family} textAnchor="end">{pct}%</text>
      <Battery x={112} pct={pct} />
      <rect x={0} y={11} width={128} height={1} fill={INK} />
    </g>
  )
}

export default function TrackerScreen({ name, caption }: { name: ScreenName; caption?: string }) {
  const screen: Screen = SCREENS[name]
  const words = screen.els.flatMap(e => ('text' in e ? [shown(e.text)] : [])).join(' · ')
  return (
    <figure className="flex flex-col gap-1.5 w-full max-w-[20rem]">
      <div className="bg-black p-2 border border-border">
        <svg
          viewBox="0 0 128 64"
          className="w-full h-auto block"
          role="img"
          aria-label={`Tracker screen: ${screen.label}${words ? `. It reads: ${words}` : ''}`}
          shapeRendering="crispEdges"
        >
          <rect width={128} height={64} fill={PANEL} />
          {screen.els.map((e, i) => <El key={i} e={e} />)}
        </svg>
      </div>
      <figcaption className="text-xs text-muted">{caption ?? screen.label}</figcaption>
    </figure>
  )
}
