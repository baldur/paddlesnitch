// The privacy page, FAQ and cookie notice make factual claims about what the
// code does. They drifted: for months they said stroke rate was discarded (it is
// kept), that there was "no analytics" (page views are counted), and they left
// out every outside service added after launch. These tests tie the claims to
// the code so the next drift fails CI instead of misleading users.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

const repo = path.resolve(__dirname, '../../../..')
const read = (rel: string) => readFileSync(path.join(repo, rel), 'utf8')
const privacy = read('apps/web/src/app/privacy/page.tsx')
const faq = read('apps/web/legal/faq.md')
const cookieNotice = read('apps/web/src/components/CookieNotice.tsx')
const layout = read('apps/web/src/app/layout.tsx')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx|kt|swift)$/.test(name) && !/\.test\./.test(name) && !/Tests?\.(kt|swift)$/.test(name)) out.push(full)
  }
  return out
}

// Every outside host the app talks to, and the name the privacy page must use
// for it. A new host fails the "unlisted" test until it is added here AND to
// the privacy page.
const SERVICES: Record<string, string> = {
  'www.strava.com': 'Strava',
  'api.open-meteo.com': 'Open-Meteo',
  'archive-api.open-meteo.com': 'Open-Meteo',
  'environment.data.gov.uk': 'Environment Agency',
  // Live river conditions on Plan: whole national lists, never a user's route.
  'timeseries.sepa.org.uk': 'SEPA',
  'waterlevel.ie': 'OPW',
  'ddapi20-waterwebservices.rijkswaterstaat.nl': 'Rijkswaterstaat',
  'download.waterinfo.be': 'waterinfo.be',
  'www.pegelonline.wsv.de': 'PEGELONLINE',
  'www.hydrodaten.admin.ch': 'BAFU',
  'opendata-download-hydroobs.smhi.se': 'SMHI',   // Swedish river flows, read by our server
  'www.smhi.se': 'SMHI',   // a station's own page   // Swiss water levels, read by our server (and a station's own page)   // German water levels, read by our server (and a gauge's own page)
  'www.gov.uk': 'GOV.UK',
  'api.github.com': 'GitHub',
  'github.com': 'GitHub',
  'server.arcgisonline.com': 'Esri',
  'www.esri.com': 'Esri',
  'service.pdok.nl': 'PDOK',
  'data.geopf.fr': 'IGN',
  'www.wms.nrw.de': 'Geobasis NRW',   // NRW aerial photos in the browser, and in print
  'gdi.berlin.de': 'Geoportal Berlin',
  'isk.geobasis-bb.de': 'LGB Brandenburg',   // Brandenburg aerial photos
  'geoservices.bayern.de': 'Bayerische Vermessungsverwaltung',   // Bavarian aerial photos
  'www.gds-srv.hessen.de': 'HVBG Hessen',   // Hessian aerial photos
  'www.geodaten-mv.de': 'LAiV Mecklenburg-Vorpommern',   // Mecklenburg aerial photos
  'owsproxy.lgl-bw.de': 'LGL Baden-Württemberg',   // Baden-Württemberg aerial photos
  'wmts.geo.admin.ch': 'swisstopo',   // Swiss aerial photos on screen
  'wms.geo.admin.ch': 'swisstopo',   // and in print
  'maps.wien.gv.at': 'basemap.at',   // Austrian aerial photos   // Berlin aerial photos in the browser, and in print   // French aerial photo tiles in the browser, and in print
  'geo.api.vlaanderen.be': 'Digitaal Vlaanderen',   // Flemish aerial photo tiles in the browser   // aerial photo tiles in the browser (and the water boards' data at build time)
  'unpkg.com': 'unpkg',
}
// Our own site, legal links and test-only values -- not processors.
const NOT_SERVICES = new Set(['paddlesnitch.com', 'www.paddlesnitch.com', 'ico.org.uk', 'creativecommons.org',
  'evil.example.com', 'example.invalid',
  'example.com',   // the Android app asks which app opens a web link (App.kt); nothing is fetched
  'check-for-flooding.service.gov.uk', 'waterlevels.sepa.org.uk', 'waterinfo.rws.nl', 'www.waterinfo.be',   // links to a gauge's own page
  'kayak.spw.wallonie.be',   // a link to Wallonia's kayak status; nothing is fetched from it
  'schema.org',   // a vocabulary name inside JSON-LD; nothing is fetched from it
  'developers.google.com',   // Google's branding rules, cited in a comment; nothing is fetched from it
])
// River-planner open data: fetched only by scripts/waterways/* on a developer's
// machine or the weekly refresh job, so no visitor's data ever reaches these hosts.
// The rest are credit links to a source. If the app ever calls one of these
// at runtime, move it to SERVICES and name it on the privacy page.
const BUILD_TIME_SOURCES = new Set([
  'services.arcgis.com', 'www.arcgis.com', 'geo.rijkswaterstaat.nl', 'data.overheid.nl', 'overpass-api.de', 'overpass.kumi.systems',
  'www.openstreetmap.org', 'data-canalrivertrust.opendata.arcgis.com', 'www.dwrace.co.uk',
  'd1hxd0sho1wxko.cloudfront.net', 'www.scottishcanals.co.uk', 'www.waterwaysireland.org', 'download.geofabrik.de',
  'environment.data.gov.uk', 'umap.openstreetmap.fr', 'www.data.gov.uk',
  'map.sepa.org.uk', 'services3.arcgis.com', 'amber.international', 'services-eu1.arcgis.com', 'www.fisheriesireland.ie', 'services9.arcgis.com', 'doi.org', 'services.sandre.eaufrance.fr', 'www.data.gouv.fr',
])

describe('privacy page names every outside service the code uses', () => {
  const hosts = new Set<string>()
  // The phone apps too: the Android app loads Esri's tiles itself.
  const apps = [
    path.join(repo, 'mobile/android/app/src/main'),
    path.join(repo, 'mobile/ios/App/Sources'),
    ...readdirSync(path.join(repo, 'mobile/ios/Packages')).map(p => path.join(repo, 'mobile/ios/Packages', p, 'Sources')),
  ].filter(d => { try { return statSync(d).isDirectory() } catch { return false } })
  for (const f of [...sourceFiles(path.join(repo, 'apps/web/src')), ...sourceFiles(path.join(repo, 'packages')), ...apps.flatMap(sourceFiles)]) {
    for (const m of readFileSync(f, 'utf8').matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)) hosts.add(m[1])
  }

  it('has no outside host missing from the list of known services', () => {
    const unlisted = [...hosts].filter(h => !(h in SERVICES) && !NOT_SERVICES.has(h) && !BUILD_TIME_SOURCES.has(h))
    expect(unlisted).toEqual([])
  })

  it.each([...new Set(Object.values(SERVICES)), 'Bedrock', 'Cognito'])('names %s', name => {
    expect(privacy).toContain(name)
  })
})

// Sign in with Google (#697) goes through Cognito's hosted sign-in, whose
// address comes from COGNITO_DOMAIN, so the host scan above can't see it.
describe('Sign in with Google is on the privacy page', () => {
  it('names Google as a sign-in service and what it passes on', () => {
    expect(privacy).toMatch(/only if you sign in with Google/)
    expect(privacy).toMatch(/your name, your email address and an ID for your Google account/)
    expect(readFileSync(path.join(repo, 'apps/web/src/lib/google-signin.ts'), 'utf8')).toContain('identity_provider')
  })
})

describe('stroke rate and heart rate claims match the parsers', () => {
  it('the FAQ and privacy page say stroke rate is kept and heart rate is not', () => {
    for (const doc of [faq, privacy]) {
      expect(doc).toMatch(/[Ss]troke rate is\s+kept/)
      expect(doc).toMatch(/[Hh]eart rate is\s+(never\s+stored|thrown\s+away)/)
      expect(doc).not.toMatch(/cadence (is|are) (intentionally |explicitly )?discarded/i)
    }
  })

  it('no page calls what we store "biometric data"', () => {
    expect(layout).not.toMatch(/biometric/i)
    expect(privacy).not.toMatch(/biometric/i)
  })
})

describe('analytics claims match the code', () => {
  it('the cookie notice does not claim there are no analytics', () => {
    expect(cookieNotice).not.toMatch(/no analytics/i)
    expect(privacy).not.toMatch(/no analytics/i)
  })
})

// Privacy audit 2026-09: the page said "We set two cookies" while the code set
// six, and it didn't say that privacy@ mail is forwarded to Gmail (a US
// transfer).
describe('cookie and email claims match the code', () => {
  const code = [...sourceFiles(path.join(repo, 'apps/web/src')), ...sourceFiles(path.join(repo, 'packages/ui/src'))]
    .map(f => readFileSync(f, 'utf8')).join('\n')

  it('the privacy page names every cookie the code sets', () => {
    const names = new Set([
      ...[...code.matchAll(/cookies\.set\(\s*'([a-z_]+)'/g)].map(m => m[1]),
      ...[...code.matchAll(/dismissKey = '([a-z_]+)'/g)].map(m => m[1]),
      'tt_id', 'tt_refresh',
    ])
    expect(names.size).toBeGreaterThanOrEqual(6)
    for (const n of names) expect(privacy, n).toContain(`<code>${n}</code>`)
  })

  it('says where email to privacy@ goes', () => {
    const stack = read('infra/lib/att-stack.ts')
    if (/FORWARD_TO: '[^']*@gmail\.com'/.test(stack)) expect(privacy).toMatch(/Gmail/)
  })
})
