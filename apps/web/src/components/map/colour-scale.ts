import type { AnalysisPoint } from '@paddlesnitch/analysis/analysis'

// The track's colour scale: slow (blue) to fast (red), or low to high stroke
// rate, between the paddle's own 10th and 90th percentiles. Pure (no Leaflet),
// so the page can draw the legend without loading the map.

export function ramp(t: number): string {
  t = Math.max(0, Math.min(1, t))
  const st: [number, number[]][] = [[0, [37, 99, 235]], [0.4, [6, 182, 212]], [0.7, [234, 179, 8]], [1, [220, 38, 38]]]
  for (let i = 1; i < st.length; i++) if (t <= st[i][0]) { const [a, b] = [st[i - 1], st[i]]; const f = (t - a[0]) / (b[0] - a[0]); return `rgb(${a[1].map((c, j) => Math.round(c + f * (b[1][j] - c))).join(',')})` }
  return 'rgb(220,38,38)'
}

export const quantile = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((p / 100) * s.length)] : 0 }

/** The low and high ends of the scale for this paddle and metric. */
export function scaleBounds(points: AnalysisPoint[], metric: 'speed' | 'sr'): { lo: number; hi: number } | null {
  const vals = points.map(p => (metric === 'speed' ? p.speed : p.sr)).filter((v): v is number => v != null && v > 0)
  if (vals.length < 2) return null
  return { lo: quantile(vals, 10), hi: quantile(vals, 90) }
}
