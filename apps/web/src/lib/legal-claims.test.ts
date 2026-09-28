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
const privacy = read('apps/web/src/app/att/privacy/page.tsx')
const faq = read('apps/web/legal/faq.md')
const cookieNotice = read('apps/web/src/components/CookieNotice.tsx')
const layout = read('apps/web/src/app/layout.tsx')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full)
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
  'api.github.com': 'GitHub',
  'github.com': 'GitHub',
  'server.arcgisonline.com': 'Esri',
  'www.esri.com': 'Esri',
  'unpkg.com': 'unpkg',
}
// Our own site, legal links and test-only values -- not processors.
const NOT_SERVICES = new Set(['paddlesnitch.com', 'www.paddlesnitch.com', 'ico.org.uk', 'evil.example.com', 'example.invalid'])

describe('privacy page names every outside service the code uses', () => {
  const hosts = new Set<string>()
  for (const f of [...sourceFiles(path.join(repo, 'apps/web/src')), ...sourceFiles(path.join(repo, 'packages'))]) {
    for (const m of readFileSync(f, 'utf8').matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)) hosts.add(m[1])
  }

  it('has no outside host missing from the list of known services', () => {
    const unlisted = [...hosts].filter(h => !(h in SERVICES) && !NOT_SERVICES.has(h))
    expect(unlisted).toEqual([])
  })

  it.each([...new Set(Object.values(SERVICES)), 'Bedrock', 'Cognito'])('names %s', name => {
    expect(privacy).toContain(name)
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
