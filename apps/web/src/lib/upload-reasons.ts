// A stable, machine-readable code on every rejected trial upload (#515), beside
// the human message. Report only: these describe the existing checks; no new
// check is enforced. Codes never change meaning; add new ones at the end.
import type { GateDiagnosis } from '@paddlesnitch/timing/geo'
import type { ParseResult } from '@paddlesnitch/timing/parse'

export const UPLOAD_REASONS = [
  'UNKNOWN_FORMAT',     // not GPX, FIT, TCX, CSV or a zip of one
  'NO_TIMESTAMPS',      // KML: geometry with no times
  'EMPTY_TRACK',        // read fine, but no points
  'UNREADABLE_FILE',    // a supported format we couldn't read
  'MISSED_START',       // never crossed the start line
  'MISSED_FINISH',      // crossed the start but never the finish
  'MISSED_GATE',        // a gate course: the next gate wasn't crossed (see `gate`)
  'WRONG_DIRECTION',    // crossed a line or gate, but only the wrong way
  'TOO_SHORT',          // every run was shorter than the course's minimum time
  'STRAVA_UNAVAILABLE', // retired: never sent since Strava was removed (2026-11); kept so codes keep their meaning
  'BAD_LINK',           // not a direct link to a .gpx file
  'FETCH_FAILED',       // the linked file couldn't be fetched
  'FILE_TOO_LARGE',     // the linked file is over 10 MB
] as const
export type UploadReason = typeof UPLOAD_REASONS[number]

type ParseFailure = Extract<ParseResult, { ok: false }>['reason']

export function parseFailureReason(r: ParseFailure): UploadReason {
  return r === 'kml_no_timing' ? 'NO_TIMESTAMPS' : r === 'empty' ? 'EMPTY_TRACK' : r === 'parse_error' ? 'UNREADABLE_FILE' : 'UNKNOWN_FORMAT'
}

/** The code for a gate course's failure, with the 1-based gate that blocked. */
export function gateReason(d: GateDiagnosis): { reason: UploadReason; gate?: number } {
  if (!d.blocking) return { reason: 'TOO_SHORT' }   // every gate passed, so only the minimum time can have failed it
  return { reason: d.blocking.reason === 'wrong_direction' ? 'WRONG_DIRECTION' : 'MISSED_GATE', gate: d.blocking.gateNumber }
}
