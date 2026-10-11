'use client'
import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import type CompareMapT from './CompareMap'

const CompareMap = dynamic(() => import('./CompareMap'), { ssr: false })

export default function CompareMapClient(props: ComponentProps<typeof CompareMapT>) {
  return <CompareMap {...props} />
}
