// Why there is or isn't a stroke rate: the recorder core's reason
// (recorder_core.h, "reason:"), or `other` for one this code doesn't know
// yet (a newer core). `not_moving`: the GPS never saw the boat moving at
// >= 4 km/h for 90 s. Its own module, without the core (./cadence.ts embeds
// 250 KB of WebAssembly), so the API contract and the browser can use it.
export const STROKE_RATE_CODES = ['ok', 'too_few_samples', 'too_slow', 'no_rhythm', 'not_moving', 'other'] as const
export type StrokeRateCode = typeof STROKE_RATE_CODES[number]
