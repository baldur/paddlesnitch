// Roughly where a visitor is (#906), from the location headers CloudFront adds
// to requests reaching the server (the managed AllViewerExceptHostHeader policy
// in infra/lib/att-stack.ts adds all of them). Only these three are read
// anywhere in the code (visitor-location.test.ts checks): never the postcode,
// latitude/longitude, metro code, time zone or the IP address.
// Never taken from what a client sends: a body can say anything.

export type VisitorLocation = { country?: string; region?: string; city?: string }

export const LOCATION_HEADERS = {
  country: 'cloudfront-viewer-country',
  region: 'cloudfront-viewer-country-region',
  city: 'cloudfront-viewer-city',
} as const

const COUNTRY = /^[A-Z]{2}$/            // ISO 3166-1 alpha-2, e.g. GB
const REGION = /^[A-Z0-9]{1,3}$/        // ISO 3166-2 subdivision, e.g. WBK
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

/** The visitor's country, region and city from CloudFront's headers, each
 *  trimmed and checked; anything that doesn't look right is left out. */
export function visitorLocation(headers: Headers): VisitorLocation {
  const country = headers.get(LOCATION_HEADERS.country)?.trim().toUpperCase()
  const region = headers.get(LOCATION_HEADERS.region)?.trim().toUpperCase()
  const city = cityOf(headers.get(LOCATION_HEADERS.city))
  const out: VisitorLocation = {}
  if (country && COUNTRY.test(country)) out.country = country
  // A region means nothing without its country.
  if (out.country && region && REGION.test(region)) out.region = region
  if (out.country && city) out.city = city
  return out
}
