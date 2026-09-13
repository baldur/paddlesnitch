'use client'
import dynamic from 'next/dynamic'

type LL = [number, number]
const SectionRaceMap = dynamic(() => import('./SectionRaceMap'), { ssr: false })

export default function SectionRaceMapClient(props: {
  racers: { trackSegment: LL[]; color: string; label: string }[]
  startLine: LL[]
  finishLine: LL[]
}) {
  return <SectionRaceMap {...props} />
}
