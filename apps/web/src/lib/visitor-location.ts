// Roughly where a visitor is (#906), from the location headers CloudFront adds
// to requests reaching the server (the managed AllViewerExceptHostHeader policy
// in infra/lib/att-stack.ts adds all of them). Only these three are read
// anywhere in the code (visitor-location.test.ts checks): never the postcode,
// latitude/longitude, metro code, time zone or the IP address.
// Never taken from what a client sends: a body can say anything.

export type VisitorLocation = { country?: string; nation?: string; city?: string }

export const LOCATION_HEADERS = {
  country: 'cloudfront-viewer-country',
  region: 'cloudfront-viewer-country-region',
  city: 'cloudfront-viewer-city',
} as const

const COUNTRY = /^[A-Z]{2}$/            // ISO 3166-1 alpha-2, e.g. GB
// The region is kept only as one of the UK's four nations. Elsewhere it's
// dropped: a first-level region is often small (a council area, a canton), and
// page views carry the tab id. AWS documents the region as the broadest ISO
// 3166-2 subdivision, which for GB is the nation (ENG, SCT, WLS, NIR); if a
// council code ever arrives instead it's dropped too, never mapped (a table of
// ~200 council codes, which change with local government reorganisations).
const NATIONS = new Set(['ENG', 'SCT', 'WLS', 'NIR'])
const CITY_MAX = 60
const CITY = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u

function cityOf(raw: string | null): string | undefined {
  if (!raw) return undefined
  // CloudFront percent-encodes non-ASCII letters (São Paulo → S%C3%A3o Paulo).
  let v = raw
  if (v.includes('%')) { try { v = decodeURIComponent(v) } catch { return undefined } }
  v = v.replace(/\s+/g, ' ').trim().slice(0, CITY_MAX).trim()
  return v && CITY.test(v) ? v : undefined
}

/** The visitor's country, UK nation and city from CloudFront's headers, each
 *  trimmed and checked; anything that doesn't look right is left out. */
export function visitorLocation(headers: Headers): VisitorLocation {
  const country = headers.get(LOCATION_HEADERS.country)?.trim().toUpperCase()
  const region = headers.get(LOCATION_HEADERS.region)?.trim().toUpperCase()
  const city = cityOf(headers.get(LOCATION_HEADERS.city))
  const out: VisitorLocation = {}
  if (country && COUNTRY.test(country)) out.country = country
  if (out.country === 'GB' && region && NATIONS.has(region)) out.nation = region
  if (out.country && city) out.city = city
  return out
}
