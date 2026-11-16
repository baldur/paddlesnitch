// Agreement between the model's 1-5 scores and the owner's, for the views job.
// Pure: no I/O, no model. The owner tunes the prompt on the even-indexed views
// in views.json and the job is measured on the odd (held-out) ones, so a prompt
// that only fits the even ones shows up as a held-out MAE that does not improve.
// See docs/night-shift/jobs/views.md (metric: views-mae).
//
// model and owner are both { viewId: 1..5 }; `ids` is the order in views.json,
// which fixes which views are even and which are odd.
export type ScoreMap = Record<string, number>

/** The views a report is over, in the order of views.json. */
export function viewsIn(ids: string[], have: ScoreMap): string[] {
  return ids.filter((id) => have[id] !== undefined)
}

/**
 * Mean absolute difference of model and owner scores, over the views `have`
 * (when given) that the owner also scored. NaN when there is nothing to compare.
 */
export function mae(model: ScoreMap, owner: ScoreMap, have?: string[]): number {
  const ids = (have ?? Object.keys(model)).filter((id) => owner[id] !== undefined && model[id] !== undefined)
  if (!ids.length) return NaN
  return ids.reduce((sum, id) => sum + Math.abs(model[id] - owner[id]), 0) / ids.length
}

/** Average ranks of the values, so tied values share a rank (the standard Spearman correction). */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0])
  const out = new Array<number>(values.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) out[order[k][1]] = avg
    i = j + 1
  }
  return out
}

/**
 * Spearman rank correlation between the two score maps, over the views both
 * have. NaN with fewer than 3 views; 1 and -1 at the extremes.
 */
export function spearman(model: ScoreMap, owner: ScoreMap, have?: string[]): number {
  const ids = (have ?? Object.keys(model)).filter((id) => owner[id] !== undefined && model[id] !== undefined)
  if (ids.length < 3) return NaN
  const rm = ranks(ids.map((id) => model[id]))
  const ro = ranks(ids.map((id) => owner[id]))
  const cm = rm.reduce((a, b) => a + b, 0) / rm.length
  const co = ro.reduce((a, b) => a + b, 0) / ro.length
  let num = 0
  let da = 0
  let db = 0
  for (let k = 0; k < rm.length; k++) {
    const a = rm[k] - cm
    const b = ro[k] - co
    num += a * b
    da += a * a
    db += b * b
  }
  return da === 0 || db === 0 ? NaN : num / Math.sqrt(da * db)
}

/** The views whose index in `ids` is even (the tuned set) and odd (held out). */
export function splitByIndex(ids: string[]): { even: string[]; odd: string[] } {
  const even: string[] = []
  const odd: string[] = []
  ids.forEach((id, i) => (i % 2 === 0 ? even : odd).push(id))
  return { even, odd }
}

/** The four numbers the job reports, computed the same way over each set. */
export function agreement(model: ScoreMap, owner: ScoreMap, ids: string[]) {
  const all = ids.filter((id) => owner[id] !== undefined && model[id] !== undefined)
  const { even, odd } = splitByIndex(ids)
  const evenHave = even.filter((id) => owner[id] !== undefined && model[id] !== undefined)
  const oddHave = odd.filter((id) => owner[id] !== undefined && model[id] !== undefined)
  return {
    n: all.length,
    of: ids.length,
    even: evenHave.length,
    odd: oddHave.length,
    mae: mae(model, owner, all),
    maeEven: mae(model, owner, evenHave),
    maeHeldOut: mae(model, owner, oddHave),
    spearman: spearman(model, owner, all),
    spearmanHeldOut: spearman(model, owner, oddHave),
  }
}
