// Every source the planner draws on, with its licence and the credit line we
// show on screen and in print. Restrictions must be explicit to keep a source
// out; with none stated we use it and credit it (docs/features/river-planner.md).
import type { SourceId } from './types'

export type SourceInfo = {
  name: string
  url: string
  licence: string
  attribution: string
}

export const SOURCES: Record<SourceId, SourceInfo> = {
  osm: {
    name: 'OpenStreetMap',
    url: 'https://www.openstreetmap.org/copyright',
    licence: 'ODbL 1.0',
    attribution: '© OpenStreetMap contributors',
  },
  crt: {
    name: 'Canal & River Trust open data',
    url: 'https://data-canalrivertrust.opendata.arcgis.com/',
    licence: 'OGL v3 (locks, weirs, slipways); facilities and towpath access: no licence stated',
    attribution: 'Contains Canal & River Trust data',
  },
  'ea-thames-locks': {
    name: 'Environment Agency — River Thames: locks and facilities for boaters',
    url: 'https://www.gov.uk/guidance/river-thames-locks-and-facilities-for-boaters',
    licence: 'OGL v3',
    attribution: 'Contains public sector information licensed under the Open Government Licence v3.0',
  },
  'ea-thames-site-guides': {
    name: 'Environment Agency — River Thames lock and weir site guides',
    url: 'https://www.gov.uk/government/publications/river-thames-lock-and-weir-fishing-site-guides',
    licence: 'OGL v3',
    attribution: 'Contains public sector information licensed under the Open Government Licence v3.0',
  },
  contribution: {
    name: 'paddlesnitch contributors',
    url: 'https://paddlesnitch.com/plan/sources',
    licence: 'CC0 1.0',
    attribution: 'Shared by paddlers on paddlesnitch',
  },
  curated: {
    name: 'paddlesnitch',
    url: 'https://paddlesnitch.com/plan/sources',
    licence: 'CC0 1.0',
    attribution: 'paddlesnitch',
  },
}
