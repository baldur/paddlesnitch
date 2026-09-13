// Marketing campaign landing variants for the platform front door (`/`).
//
// A visitor arriving with `?campaign=<id>` gets an alternate landing page
// identified by that id (so a campaign can be measured / tailored), falling
// back to the default landing when the id is unknown. Resolution is pure so it
// unit-tests cleanly; the page logs the outcome (see `page.tsx`).
//
// To add a campaign landing: add its id here, then render it in `page.tsx`'s
// `LANDINGS` map. For now `example1` reuses the default content with a visible
// marker — the registry is the seam for a genuinely different page later.

// The set of campaign ids that have a landing variant. `default` is implicit
// (the normal landing) and is never listed here.
export const CAMPAIGN_LANDINGS = ['example1'] as const
export type CampaignLanding = (typeof CAMPAIGN_LANDINGS)[number]

export type CampaignResolution = {
  // The raw id the visitor asked for (`?campaign=`), or null if none.
  requested: string | null
  // The landing actually served: a known campaign id, or 'default'.
  landing: 'default' | CampaignLanding
  // True when `requested` matched a known landing; false for none/unknown.
  found: boolean
}

// Resolve the `campaign` query param to a landing to serve. A repeated param
// (`?campaign=a&campaign=b`) arrives as an array — take the first. An unknown
// id resolves to 'default' with found=false so the caller can log the miss.
export function resolveCampaign(raw: string | string[] | undefined): CampaignResolution {
  const requested = Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null)
  if (!requested) return { requested: null, landing: 'default', found: false }
  const found = (CAMPAIGN_LANDINGS as readonly string[]).includes(requested)
  return { requested, landing: found ? (requested as CampaignLanding) : 'default', found }
}
