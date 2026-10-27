// The boat-motion charts' y-axis ticks, shared with the apps through
// mobile/contract/format/format.json: every multiple of the step within
// ±maxDeg, so the ticks are symmetric and none falls outside the chart.
export function axisTicks(maxDeg: number): number[] {
  const step = maxDeg > 12 ? 5 : maxDeg > 6 ? 3 : 2
  const top = Math.floor(maxDeg / step) * step
  const ticks: number[] = []
  for (let v = -top; v <= top; v += step) ticks.push(v === 0 ? 0 : v)
  return ticks
}
