// Environment Agency River Thames pages on GOV.UK (OGL v3), read through the
// GOV.UK Content API (JSON wrapping the page's HTML body):
//   - "River Thames: locks and facilities for boaters" — every EA lock with
//     postcode, OS grid reference, facilities and any current notice
//   - "River Thames: lock and weir fishing site guides" — for some locks, how
//     to get there by land and where to park (what a support crew needs)
import { round6 } from '../line'
import { gridRefToLatLng } from '../osgb'
import type { CrewDetail, Facility, Feature } from '../types'

export const THAMES_LOCKS_URL = 'https://www.gov.uk/api/content/guidance/river-thames-locks-and-facilities-for-boaters'
export const THAMES_GUIDES_URL = 'https://www.gov.uk/api/content/government/publications/river-thames-lock-and-weir-fishing-site-guides'
const PAGE = 'https://www.gov.uk/guidance/river-thames-locks-and-facilities-for-boaters'

const FACILITY_TEXT: [RegExp, Facility][] = [
  [/card and contactless/i, 'card_payment'],
  [/^toilet/i, 'toilet'],
  [/shower/i, 'shower'],
  [/drinking water|water point/i, 'drinking_water'],
  [/chemical toilet/i, 'elsan'],
  [/pump-out/i, 'pump_out'],
  [/refuse/i, 'refuse'],
  [/electric charging/i, 'electric_charging'],
]

/** Locks from the "Lock locations and other facilities" section. */
export function locksFromThamesPage(body: string, fetchedAt: string): Feature[] {
  const start = body.indexOf('id="lock-locations-and-other-facilities"')
  if (start < 0) throw new Error('Thames locks page: facilities section not found')
  const end = body.indexOf('<h2', start + 10)
  const section = body.slice(start, end < 0 ? undefined : end)

  const out: Feature[] = []
  const blocks = section.split(/<h3 id="([^"]+)">/).slice(1)
  for (let i = 0; i < blocks.length; i += 2) {
    const anchor = blocks[i]
    const html = blocks[i + 1]
    const name = text(html.slice(0, html.indexOf('</h3>')))
    const para = (label: string) => html.match(new RegExp(`<p>${label}:\\s*([^<]+)</p>`))?.[1].trim()
    // Multi-chamber locks label one reference per chamber — "(new lock)",
    // "(barge lock)" — so take the first, labelled or not.
    const gridRef = html.match(/<p>National grid reference(?: \([^)]*\))?:\s*([^<]+)<\/p>/)?.[1].trim()
    const at = gridRef ? gridRefToLatLng(gridRef) : null
    if (!at) continue
    const items = [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => text(m[1]))
    const facilities = [...new Set(
      items.filter(t => !/currently closed|out of use/i.test(t))
        .flatMap(t => FACILITY_TEXT.filter(([re]) => re.test(t)).map(([, f]) => f)),
    )]
    const notice = html.match(/class="[^"]*info-notice[^"]*">([\s\S]*?)<\/div>/)?.[1]
    out.push({
      id: `ea-lock:${anchor}`,
      kind: 'lock',
      name: `${name.replace(/\s*\(.*\)$/, '')} Lock`,
      at: round6(at),
      source: { source: 'ea-thames-locks', sourceId: anchor, url: `${PAGE}#${anchor}`, fetchedAt },
      lock: {
        postcode: para('Postcode'),
        gridRef,
        facilities,
        notice: notice ? text(notice) : undefined,
      },
    })
  }
  return out
}

/** The site-guide pages listed on the publication, as [lock name, path]. */
export function guidePaths(publication: { details: { attachments?: { title?: string; url?: string }[] } }): [string, string][] {
  return (publication.details.attachments ?? [])
    .map(a => [a.title?.match(/^(.+?) lock and weir/i)?.[1], a.url] as const)
    .filter((x): x is readonly [string, string] => !!x[0] && !!x[1])
    .map(([name, url]) => [name, url])
}

/** "How to find the lock" + the parking sentences from one site guide. */
export function crewFromGuide(body: string): CrewDetail {
  const section = (heading: string) => {
    const m = body.match(new RegExp(`<h2[^>]*>\\s*${heading}\\s*</h2>([\\s\\S]*?)(?=<h2|$)`, 'i'))
    return m ? [...m[1].matchAll(/<p>([\s\S]*?)<\/p>/g)].map(x => text(x[1])).filter(Boolean) : []
  }
  const find = section('How to find the lock').filter(p => !/^Address:/i.test(p) && !/book to fish|to fish at/i.test(p))
  const parking = section('Facilities').filter(p => /\bpark/i.test(p))
  return {
    postcode: body.match(/\b([A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2})\b/)?.[1],
    directions: find.join(' ') || undefined,
    parking: parking.join(' ') || undefined,
  }
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;|&lsquo;/g, '’')
    .replace(/\s+/g, ' ')
    .trim()
}
