'use client'
import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import type PortageSatelliteT from './PortageSatellite'

const PortageSatellite = dynamic(() => import('./PortageSatellite'), { ssr: false })

export default function PortageSatelliteClient(props: ComponentProps<typeof PortageSatelliteT>) {
  return <PortageSatellite {...props} />
}
