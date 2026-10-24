// What the site tells crawlers and AI assistants about itself (#513):
// robots.txt, sitemap.xml and llms.txt. Public pages only; private trials and
// courses never appear (the same canView rule as a signed-out visitor).
import type { MetadataRoute } from 'next'
import { canViewCourse, canViewTrial } from '@/lib/permissions'
import type { CourseMetadata, TrialMetadata } from '@/lib/types'

export const SITE = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://paddlesnitch.com'

/** Public pages that are always there. */
export const PUBLIC_PAGES = ['/', '/plan', '/plan/gaps', '/att', '/att/courses', '/help', '/guide', '/api', '/privacy', '/terms']

export function robots(): MetadataRoute.Robots {
  return {
    // Public pages are for everyone, assistants and search included; APIs and
    // signed-in pages aren't pages to index.
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/att/api/', '/analyse/api/', '/att/admin/', '/profile/me', '/signin'] }],
    sitemap: `${SITE}/sitemap.xml`,
  }
}

export function sitemap(trials: TrialMetadata[], courses: CourseMetadata[]): MetadataRoute.Sitemap {
  return [
    ...PUBLIC_PAGES.map(p => ({ url: `${SITE}${p === '/' ? '' : p}` })),
    ...courses.filter(c => canViewCourse(c, null)).map(c => ({ url: `${SITE}/att/courses/${c.id}` })),
    ...trials.filter(t => canViewTrial(t, null)).map(t => ({ url: `${SITE}/att/trials/${t.id}`, lastModified: t.createdAt })),
  ]
}

export const LLMS_TXT = `# paddlesnitch

> Tools for paddlers (kayak, canoe, SUP, rowing) in the UK and Ireland: plan a trip on the rivers and canals (and in the Netherlands), race GPS-timed time trials, and look back at your own paddles.

paddlesnitch is not a navigation authority. Check stream warnings, lock notices and, below Teddington, the tide before you go.

## Plan a paddle

- [Planner](${SITE}/plan): every lock, weir, wharf and towpath access point between two points on the water, with arrival times at your pace. No account needed.
- A plan lives in its link. Parameters: \`from\` and \`to\` (latitude,longitude in decimal degrees, or a lock, wharf, slipway or town by name, e.g. \`from=cropredy-lock\`), \`waterway\` (keep both ends on it), \`shape\` (\`one_way\` or \`return\`), \`at\` (start time, ISO 8601 with Z or an offset), \`pace\` (km/h, default 8), \`portage\` (minutes per portage, default 3). Example: ${SITE}/plan?from=guyers-lock&to=aldermaston-wharf&shape=return
- Full parameter reference: ${SITE}/help (Linking to a plan).
- [Gaps](${SITE}/plan/gaps): how well each waterway is known, and the locks with no portage details yet.
- [OpenPortage](${SITE}/plan/data/latest/openportage): paddlers' portage details as a CC0 JSON file.

## API

- [API docs](${SITE}/api): free, read-only JSON, no key. OpenAPI 3.1: ${SITE}/api/v1/openapi.json
- \`GET ${SITE}/api/v1/plan?from=&to=&shape=&pace=&portage=&at=\`: a plan as JSON (route as GeoJSON, every stop with distance and time). Same parameters as the planner link.
- \`GET ${SITE}/api/v1/places?q=\`: locks, wharves, slipways and towns on the water, by name.
- \`GET ${SITE}/api/v1/trials\`, \`/api/v1/trials/{id}\`, \`/api/v1/trials/{id}/leaderboard\`: public time trials and results.
- Every response carries \`attribution\`; show those credits with the data.
- MCP (read-only, no auth, Streamable HTTP): ${SITE}/mcp — tools search_places, plan_route, list_trials, get_trial, get_leaderboard.

## Time trials

- [Trials](${SITE}/att): open time trials. Paddle the course, upload the GPS file (GPX, FIT, TCX, CSV), and the time is worked out from where the track crosses the start and finish lines.
- [Courses](${SITE}/att/courses): the courses trials are raced on.

## Data and licences

- Rivers and canals: OpenStreetMap contributors (ODbL), Canal & River Trust, Environment Agency.
- River levels and stream warnings: Environment Agency. Weather: Open-Meteo.
- Paddlers' portage details: CC0 (OpenPortage).

## Help

- [Help](${SITE}/help) · [Tracker guide](${SITE}/guide) · [Privacy](${SITE}/privacy) · [Terms](${SITE}/terms)
`

/** A public trial as a schema.org SportsEvent (JSON-LD), so search engines
 *  and assistants can read what, when and where. Null for anything a
 *  signed-out visitor couldn't see. */
export function trialJsonLd(trial: TrialMetadata, course: CourseMetadata | null): Record<string, unknown> | null {
  if (!canViewTrial(trial, null)) return null
  const [[a, b], [c, d]] = course?.startLine ?? [[NaN, NaN], [NaN, NaN]]
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: trial.name,
    startDate: trial.date,
    url: `${SITE}/att/trials/${trial.id}`,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(course ? {
      sport: course.sport === 'rowing' ? 'Rowing' : course.sport === 'kayak' ? 'Kayaking' : 'Paddle sports',
      description: `GPS-timed time trial over ${course.distanceMetres.toLocaleString('en-GB')} m on ${course.name}.`,
      location: {
        '@type': 'Place', name: course.name,
        ...(Number.isFinite(a) ? { geo: { '@type': 'GeoCoordinates', latitude: +((a + c) / 2).toFixed(6), longitude: +((b + d) / 2).toFixed(6) } } : {}),
      },
    } : {}),
  }
}
