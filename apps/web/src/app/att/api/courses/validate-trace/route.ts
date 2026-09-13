import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { parseTrace } from '@/lib/parse'
import { processTrace, diagnoseGates, gateDiagnosisMessage } from '@/lib/geo'
import type { CourseType, Line } from '@/lib/types'

// Organiser tool (#71): upload a reference GPS trace and check it matches a
// course's geometry — especially gate directions, which are easy to set
// backwards and otherwise only surface when an athlete's upload fails. Pure
// validation: nothing is stored, no entry is created. Sign-in required because
// only organisers building a course need it.
//
// Multipart form: `file` (the reference trace) + `geometry` (JSON string with
// type, startLine?, finishLine?, gates?, gateDirection?, minValidSeconds?).

type Geometry = {
  type: CourseType
  startLine?: Line
  finishLine?: Line
  gates?: Array<{ line: Line; direction: 1 | -1 }>
  gateDirection?: 1 | -1
  minValidSeconds?: number
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  let geometry: Geometry
  try {
    geometry = JSON.parse(String(form.get('geometry')))
  } catch {
    return NextResponse.json({ error: 'Invalid geometry' }, { status: 400 })
  }
  // Just enough validation to run the matcher meaningfully.
  if (geometry.type === 'gate') {
    if (!Array.isArray(geometry.gates) || geometry.gates.length < 2) {
      return NextResponse.json({ error: 'A gate course needs at least 2 gates to validate.' }, { status: 400 })
    }
  } else if (!geometry.startLine) {
    return NextResponse.json({ error: 'Draw the course lines before validating.' }, { status: 400 })
  }

  const parsed = await parseTrace(file.name, await file.arrayBuffer())
  if (!parsed.ok) {
    return NextResponse.json({ error: `Could not parse file: ${parsed.reason}` }, { status: 422 })
  }

  const result = processTrace(
    parsed.track,
    geometry.startLine ?? [[0, 0], [0, 0]],
    geometry.finishLine,
    geometry.type,
    geometry.minValidSeconds ?? 0,
    geometry.gateDirection,
    geometry.gates,
  )

  if (result) {
    return NextResponse.json({ matched: true, totalElapsedSeconds: result.totalElapsedSeconds })
  }

  // For gate courses, explain which gate blocked the match (the whole point of
  // this tool — catching a backwards gate before anyone races).
  const gateAnalysis = geometry.type === 'gate' && geometry.gates && geometry.gates.length >= 2
    ? diagnoseGates(parsed.track, geometry.gates)
    : undefined
  const message = gateAnalysis
    ? gateDiagnosisMessage(gateAnalysis)
    : 'This trace did not pass through the course as drawn.'

  return NextResponse.json({ matched: false, gateAnalysis, message })
}
