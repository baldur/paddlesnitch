// Looking for improved data, weekly (docs/features/waterways-uk-ireland.md,
// "Scheduling"): open-data catalogues searched for new or changed datasets
// about locks, weirs, slipways, canoe access and the like. Pure: parsing and
// filtering here; scripts/waterways/discover.ts fetches and the refresh
// workflow posts one digest issue a week.

export type Candidate = {
  catalogue: 'data.gov.ie' | 'OpenDataNI' | 'ArcGIS Online' | 'data.overheid.nl'
  id: string
  title: string
  url: string
  publisher?: string
  created: string                // ISO: catalogues re-touch "modified" on every harvest
  licence?: string
}

/** Titles worth a look: what a paddler meets on the water. */
export const KEYWORDS = /\b(locks?|weirs?|sluices?|slipways?|portages?|canoe(ing)?|kayak(ing)?|paddl\w*|blueways?|towpaths?|launch(es|ing)?|access points?|canals?|river levels?|barriers?|sluis(zen)?|stuw(en)?|kano\w*|trailerhelling\w*|overdraag\w*|aanlegplaats\w*)\b/i

/** Sources we use or have looked at and turned down, by id or a URL fragment,
 *  so the digest never suggests them again. */
export const KNOWN: { match: string; status: 'used' | 'rejected'; note: string }[] = [
  { match: 'DknzyjEEie5tEW0u', status: 'used', note: 'Canal & River Trust ArcGIS organisation' },
  { match: 'dYoxQ9gPdVpFX6Th', status: 'used', note: 'Waterways Ireland ArcGIS organisation' },
  { match: 'Bb8lfThdhugyc4G3', status: 'used', note: 'The Rivers Trust (AMBER-GB; River Obstacles rejected: conflicting licences)' },
  { match: 'tnPmSZbB6GEKJjh8', status: 'used', note: 'Inland Fisheries Ireland barriers' },
  { match: 'AireRiversTrust', status: 'rejected', note: 'Survey working maps, not a maintained dataset' },
  { match: 'water-recreation', status: 'rejected', note: 'EA water recreation zones: centroids, part CC BY-NC-SA' },
  { match: 'national-barriers-programme', status: 'used', note: 'IFI barriers (the dashboard and its data)' },
  { match: 'Marine Institute', status: 'rejected', note: 'Ocean and coastal monitoring, not inland water' },
  // The Netherlands. The register re-harvests datasets, so they look new each time.
  { match: 'FIS_VNDS', status: 'used', note: 'Rijkswaterstaat fairway information: locks and trailer slipways (rws-fis)' },
  { match: 'Waterschappen Kunstwerken', status: 'used', note: 'The water boards\' structures via PDOK (nl-waterboards)' },
]

export const isKnown = (c: Candidate) => KNOWN.some(k => c.id.includes(k.match) || c.url.includes(k.match) || (c.publisher ?? '').includes(k.match) || c.title.includes(k.match))

/** A CKAN package_search result (data.gov.ie, OpenDataNI). */
export function fromCkan(catalogue: Candidate['catalogue'], base: string, results: unknown[]): Candidate[] {
  return results.flatMap(raw => {
    const p = raw as Record<string, unknown>
    const name = String(p.name ?? p.id ?? '')
    if (!name) return []
    return [{
      catalogue, id: String(p.id ?? name), title: String(p.title ?? name), url: `${base}/dataset/${name}`,
      publisher: ((p.organization as Record<string, unknown> | undefined)?.title as string | undefined) ?? undefined,
      created: String(p.metadata_created ?? ''), licence: (p.license_title as string | undefined) ?? undefined,
    }]
  })
}

/** Britain and Ireland, [[west, south], [east, north]]. ArcGIS's bbox search
 *  matches anything that overlaps it, including the world-extent survey forms
 *  people publish everywhere, so an item must sit inside it. */
export const UK_IE: [[number, number], [number, number]] = [[-11, 49.5], [2, 61]]

const insideUkIe = (extent: unknown) => {
  if (!Array.isArray(extent) || extent.length !== 2) return false
  const [[w, s], [e, n]] = extent as [[number, number], [number, number]]
  return w >= UK_IE[0][0] && s >= UK_IE[0][1] && e <= UK_IE[1][0] && n <= UK_IE[1][1]
}

/** An ArcGIS Online sharing search result, kept only when it lies in Britain
 *  or Ireland and isn't a survey form. */
export function fromArcgis(results: unknown[]): Candidate[] {
  return results.flatMap(raw => {
    const r = raw as Record<string, unknown>
    if (typeof r.id !== 'string' || !insideUkIe(r.extent) || /_form$|survey/i.test(String(r.title ?? ''))) return []
    return [{
      catalogue: 'ArcGIS Online' as const, id: r.id, title: String(r.title ?? r.id),
      url: `https://www.arcgis.com/home/item.html?id=${r.id}`, publisher: (r.owner as string | undefined) ?? undefined,
      created: new Date(Number(r.created ?? 0)).toISOString(),
      licence: typeof r.licenseInfo === 'string' ? r.licenseInfo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : undefined,
    }]
  })
}

/** Created in the window, about the water, and not already known. One per id. */
export function newCandidates(all: Candidate[], since: Date): Candidate[] {
  const seen = new Set<string>()
  return all
    .filter(c => Date.parse(c.created) >= since.getTime() && KEYWORDS.test(c.title.replace(/_/g, ' ')) && !isKnown(c))
    .filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .sort((a, b) => b.created.localeCompare(a.created))
}

/** The weekly digest, as an issue body. */
export function digest(candidates: Candidate[], since: Date): string {
  const lines = [
    `New datasets about the water since ${since.toISOString().slice(0, 10)}, from data.gov.ie, OpenDataNI, ArcGIS Online (UK and Ireland) and data.overheid.nl (the Netherlands). Each might improve the river planner; none is used until it's added to \`fetch-sources.ts\` with its licence checked.`,
    '',
    'To stop one coming back, add it to `KNOWN` in `packages/waterways/src/discovery.ts` as used or rejected.',
    '',
  ]
  for (const c of candidates) lines.push(`- [ ] [${c.title}](${c.url}) · ${c.catalogue}${c.publisher ? ` · ${c.publisher}` : ''} · ${c.created.slice(0, 10)}${c.licence ? ` · ${c.licence}` : ''}`)
  return lines.join('\n')
}
