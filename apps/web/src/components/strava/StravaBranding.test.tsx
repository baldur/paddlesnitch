import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import StravaButton from './StravaButton'
import PoweredByStrava from './PoweredByStrava'
import ViewOnStrava from './ViewOnStrava'

// #107 — Strava brand-guideline components. These render the official (vendored)
// artwork as-is and wire the links; the tests pin the asset paths + hrefs so a
// later swap to the official files (same filenames) stays wired correctly.

describe('Strava brand components (#107)', () => {
  it('the button on the auth flow uses the official "Connect with Strava" artwork', () => {
    // Strava ships a single "Connect with Strava" button (no separate sign-in
    // button), so the auth page uses it too.
    const html = renderToStaticMarkup(<StravaButton href="/att/api/auth/strava/init?next=%2Fatt" />)
    expect(html).toContain('/strava/connect-with-strava.svg')
    expect(html).toContain('alt="Connect with Strava"')
    expect(html).toContain('href="/att/api/auth/strava/init?next=%2Fatt"')
  })

  it('the connect button links to the connect flow with the same artwork', () => {
    const html = renderToStaticMarkup(<StravaButton href="/att/api/strava/connect" />)
    expect(html).toContain('/strava/connect-with-strava.svg')
    expect(html).toContain('alt="Connect with Strava"')
    expect(html).toContain('href="/att/api/strava/connect"')
  })

  it('powered-by renders the attribution logo', () => {
    const html = renderToStaticMarkup(<PoweredByStrava />)
    expect(html).toContain('/strava/powered-by-strava.svg')
    expect(html).toContain('alt="Powered by Strava"')
  })

  it('view-on-strava links back to the source activity', () => {
    const html = renderToStaticMarkup(<ViewOnStrava activityId={12345} />)
    expect(html).toContain('https://www.strava.com/activities/12345')
    expect(html).toContain('View on Strava')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})
