// Every source the planner draws on, with its licence and the credit line we
// show on screen and in print. Restrictions must be explicit to keep a source
// out; with none stated we use it and credit it (docs/features/river-planner.md).
import type { SourceId } from './types'

export type SourceInfo = {
  name: string
  url: string
  licence: string
  attribution: string
  /** Licensed for non-commercial use only: fine while paddlesnitch is free
   *  (owner, 2026-10-12); must never feed the CC0 contribution layer. */
  nonCommercial?: true
  /** Share-alike (CC BY-SA): published in its own file (sa-features), like the
   *  OSM layer, never merged into the core features or the CC0 contributions
   *  (owner, 2026-10-21). */
  shareAlike?: true
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
  'ea-aims': {
    name: 'Environment Agency — AIMS structures (weirs and slipways)',
    url: 'https://www.data.gov.uk/dataset/235b866e-fde8-475a-9ae3-72ae0744457b',
    licence: 'OGL v3',
    attribution: '© Environment Agency copyright and/or database right',
  },
  'ea-umap': {
    name: 'Environment Agency — Anglian waterways maps and navigation notices (uMap)',
    url: 'https://www.gov.uk/guidance/river-nene-bridge-heights-locks-and-facilities',
    licence: 'No licence stated (used with credit)',
    attribution: 'Environment Agency navigation maps and notices',
  },
  sepa: {
    name: 'SEPA — Obstacles to Fish Passage',
    url: 'https://map.sepa.org.uk/server/rest/services/Open/Hydrography/MapServer/5',
    licence: 'OGL v3',
    attribution: 'Contains SEPA data © Scottish Environment Protection Agency and database right',
  },
  amber: {
    name: 'AMBER barrier atlas (Great Britain)',
    url: 'https://amber.international/european-barrier-atlas/',
    licence: 'CC BY 4.0',
    attribution: 'AMBER Barrier Atlas: Jones et al. (2019), CC BY 4.0',
  },
  ifi: {
    name: 'Inland Fisheries Ireland — National Barriers Programme',
    url: 'https://www.fisheriesireland.ie/what-we-do/research/national-barriers-programme',
    licence: 'CC BY 4.0',
    attribution: 'Barrier data © Inland Fisheries Ireland, CC BY 4.0',
  },
  'nl-waterboards': {
    name: 'Dutch water boards — Waterschappen Kunstwerken IMWA (via PDOK)',
    url: 'https://data.overheid.nl/en/dataset/waterschappen-kunstwerken-imwa',
    licence: 'CC BY-SA 4.0',
    attribution: 'Weirs, dams and pumping stations: Dutch water boards (Het Waterschapshuis), CC BY-SA 4.0',
    shareAlike: true,
  },
  'amber-eu': {
    name: 'AMBER Atlas of Instream Barriers in Europe',
    url: 'https://doi.org/10.6084/m9.figshare.12629051.v5',
    licence: 'CC BY 4.0',
    attribution: 'Barriers in Belgium: AMBER Consortium, Belletti et al. (2020) Nature 588, CC BY 4.0',
  },
  roe: {
    name: 'Référentiel des obstacles à l’écoulement (ROE), France',
    url: 'https://www.data.gouv.fr/datasets/obstacles-a-lecoulement-metropole',
    licence: 'Licence Ouverte 2.0',
    attribution: 'Weirs and dams in France: ROE, Office français de la biodiversité (OFB) / Sandre, Licence Ouverte 2.0',
  },
  'rws-fis': {
    name: 'Rijkswaterstaat — Vaarweginformatie (FIS/VNDS)',
    url: 'https://data.overheid.nl/en/dataset/49337-vaarweginformatie-sluizen',
    licence: 'CC0',
    attribution: 'Locks and slipways: Rijkswaterstaat, CC0',
  },
  'ea-levels': {
    name: 'Environment Agency real-time flood-monitoring API',
    url: 'https://environment.data.gov.uk/flood-monitoring/doc/reference',
    licence: 'OGL v3',
    attribution: 'This uses Environment Agency flood and river level data from the real-time data API (Beta)',
  },
  'sepa-levels': {
    name: 'SEPA river levels',
    url: 'https://timeseries.sepa.org.uk/KiWIS/KiWIS',
    licence: 'OGL v3',
    attribution: 'River levels © Scottish Environment Protection Agency',
  },
  'opw-levels': {
    name: 'OPW waterlevel.ie',
    url: 'https://waterlevel.ie',
    licence: 'CC BY 4.0',
    attribution: 'Water levels © Office of Public Works (waterlevel.ie), CC BY 4.0',
  },
  'rws-levels': {
    name: 'Rijkswaterstaat — Waterinfo (DDL)',
    url: 'https://waterinfo.rws.nl/',
    licence: 'Open data',
    attribution: 'Water levels: Rijkswaterstaat',
  },
  'waterinfo-levels': {
    name: 'waterinfo.be (VMM, De Vlaamse Waterweg)',
    url: 'https://www.waterinfo.be/',
    licence: 'CC BY 4.0',
    attribution: 'Water levels: waterinfo.be (VMM, De Vlaamse Waterweg), CC BY 4.0',
  },
  'pegelonline-levels': {
    name: 'PEGELONLINE (Wasserstraßen- und Schifffahrtsverwaltung des Bundes)',
    url: 'https://www.pegelonline.wsv.de/',
    licence: 'Datenlizenz Deutschland – Zero – 2.0',
    attribution: 'Water levels: PEGELONLINE, WSV',
  },
  'thames-conditions': {
    name: 'GOV.UK — River Thames: current river conditions',
    url: 'https://www.gov.uk/guidance/river-thames-current-river-conditions',
    licence: 'OGL v3',
    attribution: 'Thames stream warnings: contains public sector information licensed under the Open Government Licence v3.0',
  },
  'scottish-canals': {
    name: 'Scottish Canals open data',
    url: 'https://www.scottishcanals.co.uk/scottish-canals-data-portal',
    licence: 'OGL v3',
    attribution: 'Data provided by Scottish Canals, licensed under the Open Government Licence',
  },
  'waterways-ireland': {
    name: 'Waterways Ireland',
    url: 'https://www.waterwaysireland.org',
    licence: 'Non-commercial use with acknowledgement',
    attribution: 'Contains data from Waterways Ireland',
    nonCommercial: true,
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
