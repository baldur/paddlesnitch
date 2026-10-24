// A course's lines as text (#510): the trial page's map has no other way to
// tell a screen reader or an agent where the start, finish and gates are.
import type { CourseMetadata } from '@/lib/types'

const at = ([lat, lng]: [number, number]) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`
const line = (l: [number, number][]) => `from ${at(l[0])} to ${at(l[1])}`

export function courseLinesText(course: Pick<CourseMetadata, 'type' | 'startLine' | 'finishLine' | 'gates' | 'distanceMetres'>): string[] {
  const out: string[] = []
  if (course.type === 'gate' && course.gates?.length) {
    course.gates.forEach((g, i) => out.push(`${i === 0 ? 'Start gate' : i === course.gates!.length - 1 ? 'Finish gate' : `Gate ${i + 1}`}: ${line(g.line)}`))
  } else if (course.finishLine) {
    out.push(`Start line: ${line(course.startLine)}`, `Finish line: ${line(course.finishLine)}`)
  } else {
    out.push(`Crossing line (start and finish): ${line(course.startLine)}`)
  }
  out.push(`Distance: ${course.distanceMetres.toLocaleString('en-GB')} m`)
  return out
}
