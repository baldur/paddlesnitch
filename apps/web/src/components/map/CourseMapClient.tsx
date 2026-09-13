'use client'
import dynamic from 'next/dynamic'
import type { CourseMetadata, LatLng } from '@/lib/types'

const CourseMap = dynamic(() => import('./CourseMap'), { ssr: false })

export default function CourseMapClient({ course, track, highlightGateIndex }: { course: CourseMetadata; track?: LatLng[]; highlightGateIndex?: number }) {
  return <CourseMap course={course} track={track} highlightGateIndex={highlightGateIndex} />
}
