import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { getRequestUser } from '@/lib/auth'
import { fetchPublicFile } from '@/lib/fetch-public-file'
import { getJson, putJson, putObject } from '@/lib/storage'
import { indexEntry } from '@/lib/entries'
import { trackToCsv } from '@paddlesnitch/timing/csv'
import { parseTrace, parseFailureMessage } from '@/lib/parse'
import { processTrace, diagnoseGates, gateDiagnosisMessage, lineMidpoint, noRunReason } from '@/lib/geo'
import { gateReason, parseFailureReason } from '@/lib/upload-reasons'
import { captureConditions } from '@/lib/conditions'
import { emitMetric } from '@/lib/metrics'
import { isBoatClass, validateCrew } from '@/lib/types'
import { utcDateString } from '@/lib/format'
import { rebuildLeaderboard } from '@/lib/leaderboard'
import { getDeviceSessionTrace } from '@/lib/devices'
import { canSubmitToTrial, canViewTrial } from '@/lib/permissions'
import { getUserGroupIds } from '@/lib/groups'
import type { TrialMetadata, CourseMetadata, ProcessedResult, BoatClass, CrewMember, TrackPoint, LatLng, EntryConditions } from '@/lib/types'
import { withAction } from '@/lib/action'

// Reduce a parsed track to [lat, lng] pairs for the diagnostic map we return
// when processing fails. A track can be many thousands of points; ~1500
// is plenty to show the shape of the track, and keeps the 422 payload bounded.
// The final point is always included so the track's end is drawn accurately.
function trackToLatLngs(track: TrackPoint[], max = 1500): LatLng[] {
  const stride = Math.max(1, Math.ceil(track.length / max))
  const out: LatLng[] = []
  for (let i = 0; i < track.length; i += stride) out.push([track[i].lat, track[i].lng])
  const last = track[track.length - 1]
  if (last && (out.length === 0 || out[out.length - 1][0] !== last.lat || out[out.length - 1][1] !== last.lng)) {
    out.push([last.lat, last.lng])
  }
  return out
}

type StoredEntry = {
  entryId: string
  userId: string
  displayName: string
  submittedAt: string
  filename: string
  raceDate: string                 // ISO date (YYYY-MM-DD) — inferred from the trace (#123)
  boatClass: BoatClass
  crew: CrewMember[]
  result: ProcessedResult
  conditions?: EntryConditions   // weather + river flow at finish time (#106)
}

function resolveActivityUrl(url: string): string | null {
  if (/\.gpx(\?.*)?$/i.test(url)) return url
  return null
}

// Parses the `crew` form field (JSON string in multipart, array in JSON body)
// and normalises the seat values (incoming JSON may have seat: "1" instead of 1).
// One message for any malformed crew field: the form builds it, so a person
// only sees this if something went wrong in between.
const CREW_ERROR = 'Crew details are incomplete. Please check each seat.'

function parseCrewField(raw: unknown): CrewMember[] | { error: string } {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return { error: CREW_ERROR } }
  }
  if (!Array.isArray(parsed)) return { error: CREW_ERROR }
  const out: CrewMember[] = []
  for (const m of parsed) {
    if (!m || typeof m !== 'object') return { error: CREW_ERROR }
    const rec = m as { name?: unknown; seat?: unknown }
    if (typeof rec.name !== 'string') return { error: 'crew member name must be a string' }
    let seat: number | 'C'
    if (rec.seat === 'C' || rec.seat === 'c') seat = 'C'
    else if (typeof rec.seat === 'number' && Number.isInteger(rec.seat) && rec.seat > 0) seat = rec.seat
    else if (typeof rec.seat === 'string' && /^\d+$/.test(rec.seat)) seat = parseInt(rec.seat, 10)
    else return { error: CREW_ERROR }
    out.push({ name: rec.name.trim(), seat })
  }
  return out
}

const GENERIC_NO_MATCH = 'Your activity did not cross the course start and finish lines. Make sure your GPS was recording when you passed through both.'

async function processBuffer(
  arrayBuffer: ArrayBuffer,
  filename: string,
  course: CourseMetadata,
  user: { id: string; displayName: string },
  trialId: string,
  boatClass: BoatClass,
  crew: CrewMember[],
  trialDate: string,
): Promise<NextResponse> {
  const parseResult = await parseTrace(filename, arrayBuffer)
  if (!parseResult.ok) {
    return NextResponse.json({ error: parseFailureMessage(parseResult.reason), reason: parseFailureReason(parseResult.reason) }, { status: 422 })
  }
  return processTrack(parseResult.track, filename, course, user, trialId, boatClass, crew, trialDate)
}

// Shared backend for file uploads, URL fetches and tracker recordings. Takes an
// already-parsed track; the parsed track (as CSV) is kept on disk for audit.
async function processTrack(
  track: TrackPoint[],
  filename: string,
  course: CourseMetadata,
  user: { id: string; displayName: string },
  trialId: string,
  boatClass: BoatClass,
  crew: CrewMember[],
  trialDate: string,
): Promise<NextResponse> {
  const result = processTrace(track, course.startLine, course.finishLine, course.type, course.minValidSeconds ?? 0, course.gateDirection, course.gates)
  if (!result) {
    // For gate courses, work out HOW FAR the run got and what blocked the next
    // gate (wrong direction vs never crossed), so the error can be actionable
    // instead of a generic "didn't cross the lines". See issue #66.
    const gateAnalysis = course.type === 'gate' && course.gates && course.gates.length >= 2
      ? diagnoseGates(track, course.gates)
      : undefined
    const message = gateAnalysis ? gateDiagnosisMessage(gateAnalysis) : GENERIC_NO_MATCH
    const code = gateAnalysis ? gateReason(gateAnalysis)
      : { reason: noRunReason(track, course.startLine, course.finishLine, course.type, course.gateDirection) }

    // Persist the FULL failing track + course geometry so a failure can be
    // reproduced and debugged offline — successful entries are saved, but a
    // trace that doesn't match leaves nothing behind otherwise. Best-effort:
    // a storage hiccup must not turn the user's 422 into a 500. See issue #66.
    try {
      const failureId = nanoid()
      await putJson(`trials/${trialId}/failed-uploads/${user.id}/${failureId}/diagnostic.json`, {
        failedAt: new Date().toISOString(),
        trialId,
        userId: user.id,
        displayName: user.displayName,
        filename,
        course,
        gateAnalysis,
        trackPointCount: track.length,
        track: track.map(p => ({ lat: p.lat, lng: p.lng, timestamp: p.timestamp.toISOString() })),
      })
    } catch (err) {
      console.error('[upload] could not persist failed-upload diagnostic:', err)
    }

    // Hand back the parsed track + course geometry (and gate analysis) so the
    // upload page can show a map of what we recorded against the lines and
    // highlight the blocking gate.
    return NextResponse.json(
      {
        error: message,
        ...code,
        diagnostic: { track: trackToLatLngs(track), course, gateAnalysis },
      },
      { status: 422 }
    )
  }

  // The race date is inferred from the trace itself — the UTC date of the first
  // track point — falling back to the trial's date only if the trace has no
  // usable timestamp. There's no user-entered date to reconcile against, so the
  // old discrepancy warning is gone (#123).
  const raceDate = utcDateString(track[0].timestamp) || trialDate

  const entryId = nanoid()
  const basePath = `trials/${trialId}/entries/${user.id}/${entryId}`

  // Keep the PARSED track, never the uploaded file: GPX/FIT/TCX exports carry
  // heart rate and device serials, and the privacy page promises heart rate is
  // never stored.
  await putObject(`${basePath}/trace.csv`, trackToCsv(track))

  // Best-effort weather + river-flow snapshot at the finish time and the course
  // location (start-line midpoint). Never let a conditions failure affect the
  // upload — swallow everything. See #106. Skipped under vitest so the upload
  // tests don't make live Open-Meteo / EA calls (slow + flaky); the conditions
  // clients have their own unit tests with mocked fetch.
  const [clat, clng] = lineMidpoint(course.startLine)
  const conditions = process.env.VITEST
    ? null
    : await captureConditions(clat, clng, result.finishTimestamp).catch(() => null)

  const stored: StoredEntry = {
    entryId,
    userId: user.id,
    displayName: user.displayName,
    submittedAt: new Date().toISOString(),
    filename,
    raceDate,
    boatClass,
    crew,
    result,
    ...(conditions ? { conditions } : {}),
  }
  await putJson(`${basePath}/result.json`, stored)
  await indexEntry(entryId, trialId, user.id)
  await rebuildLeaderboard(trialId)

  emitMetric('upload')
  return NextResponse.json({ entryId, result }, { status: 201 })
}

async function post(
  req: NextRequest,
  { params }: { params: Promise<{ trialId: string }> }
) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { trialId } = await params
  const trial = await getJson<TrialMetadata>(`trials/${trialId}/metadata.json`)
  if (!trial) return NextResponse.json({ error: 'Trial not found' }, { status: 404 })
  // Submission gate: combines visibility AND participation. A 404 covers
  // both "can't see" and "can see but not invited" so the route doesn't
  // distinguish — invitational trials don't leak their guest list through
  // a 403 vs 404 split.
  //
  // A valid shareable submit token (?invite=) bypasses the PARTICIPATION gate —
  // it's the organiser explicitly letting link-holders submit to a members /
  // invitational trial — but viewing is still required (so it can't submit to a
  // trial the user can't even see).
  const viewerGroupIds = new Set(await getUserGroupIds(user.id))
  const invite = new URL(req.url).searchParams.get('invite')
  const tokenOk = !!trial.submitToken && invite === trial.submitToken && canViewTrial(trial, user, viewerGroupIds)
  if (!tokenOk && !canSubmitToTrial(trial, user, viewerGroupIds)) {
    return NextResponse.json({ error: 'Trial not found' }, { status: 404 })
  }
  if (trial.status !== 'open')
    return NextResponse.json({ error: 'This trial is closed.' }, { status: 400 })

  const course = await getJson<CourseMetadata>(`courses/${trial.courseId}/metadata.json`)
  if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 })

  const contentType = req.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const body = await req.json()
    const { url, deviceId, deviceSessionId, boatClass, crew: rawCrew } = body
    if (!url && !deviceSessionId) {
      return NextResponse.json({ error: 'Choose a file, a link or a tracker recording.' }, { status: 400 })
    }
    if (!isBoatClass(boatClass)) {
      return NextResponse.json({ error: 'Choose a boat class.' }, { status: 400 })
    }
    const crew = parseCrewField(rawCrew)
    if ('error' in crew) return NextResponse.json({ error: crew.error }, { status: 400 })
    const crewError = validateCrew(boatClass, crew)
    if (crewError) return NextResponse.json({ error: crewError }, { status: 400 })

    // Tracker branch: one of the user's own tracker recordings, read from where
    // the tracker uploaded it (owner-checked: someone else's recording reads
    // as not found). Tracker owners had no way to enter a trial otherwise.
    if (deviceSessionId) {
      const raw = typeof deviceId === 'string' && typeof deviceSessionId === 'string'
        ? await getDeviceSessionTrace(user.id, deviceId.toUpperCase(), deviceSessionId) : null
      if (!raw) return NextResponse.json({ error: 'We can’t find that tracker recording.' }, { status: 404 })
      const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
      return processBuffer(ab, `tracker-${deviceSessionId}.csv`, course, user, trialId, boatClass, crew, trial.date)
    }

    const resolvedUrl = resolveActivityUrl(url)
    if (!resolvedUrl) {
      return NextResponse.json(
        { error: 'Use a direct link to a .gpx file.', reason: 'BAD_LINK' },
        { status: 422 }
      )
    }

    // https only, public hosts only, no redirects, 10 s, 10 MB (fetch-public-file.ts).
    const fetched = await fetchPublicFile(resolvedUrl, 10 * 1024 * 1024)
    if ('error' in fetched) {
      return NextResponse.json(
        {
          error: fetched.error === 'too_large'
            ? 'That file is too large. Download it and upload the file instead.'
            : 'Couldn’t fetch that activity. Use a public https link, or download it and upload the file.',
          reason: fetched.error === 'too_large' ? 'FILE_TOO_LARGE' : 'FETCH_FAILED',
        },
        { status: 422 }
      )
    }
    return processBuffer(fetched.data, 'activity.gpx', course, user, trialId, boatClass, crew, trial.date)
  }

  // File upload (multipart/form-data)
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 })
  const boatClassRaw = formData.get('boatClass')
  if (!isBoatClass(boatClassRaw)) {
    return NextResponse.json({ error: 'Choose a boat class.' }, { status: 400 })
  }
  const crew = parseCrewField(formData.get('crew'))
  if ('error' in crew) return NextResponse.json({ error: crew.error }, { status: 400 })
  const crewError = validateCrew(boatClassRaw, crew)
  if (crewError) return NextResponse.json({ error: crewError }, { status: 400 })

  const arrayBuffer = await file.arrayBuffer()
  return processBuffer(arrayBuffer, file.name, course, user, trialId, boatClassRaw, crew, trial.date)
}

export const POST = withAction('upload', post)
