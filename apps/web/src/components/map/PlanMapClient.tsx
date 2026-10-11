'use client'
import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import type PlanMapT from './PlanMap'

const PlanMap = dynamic(() => import('./PlanMap'), { ssr: false })

export default function PlanMapClient(props: ComponentProps<typeof PlanMapT>) {
  return <PlanMap {...props} />
}
