// Looking for improved data (packages/waterways/src/discovery.ts): catalogue
// results become candidates, and only new, British or Irish, water-related,
// not-yet-known ones reach the weekly digest.
import { describe, expect, it } from 'vitest'
import { digest, fromArcgis, fromCkan, newCandidates, type Candidate } from '@paddlesnitch/waterways/discovery'

const since = new Date('2026-10-01T00:00:00Z')
const at = (d: string) => Date.parse(d)

describe('discovery', () => {
  it('reads CKAN results with their created date, not the re-harvested modified date', () => {
    const [c] = fromCkan('data.gov.ie', 'https://data.gov.ie', [{
      id: 'abc', name: 'shannon-slipways', title: 'Shannon Slipways', organization: { title: 'Some Council' },
      metadata_created: '2026-10-05T10:00:00Z', metadata_modified: '2026-10-16T10:00:00Z', license_title: 'CC BY 4.0',
    }])
    expect(c).toEqual({
      catalogue: 'data.gov.ie', id: 'abc', title: 'Shannon Slipways', url: 'https://data.gov.ie/dataset/shannon-slipways',
      publisher: 'Some Council', created: '2026-10-05T10:00:00Z', licence: 'CC BY 4.0',
    })
  })

  it('keeps ArcGIS items inside Britain and Ireland and drops world-extent survey forms', () => {
    const got = fromArcgis([
      { id: 'in', title: 'IW_Slipways', owner: 'someone', created: at('2026-10-04'), extent: [[-9, 52], [-6, 54]] },
      { id: 'world', title: 'Kayak launches', created: at('2026-10-04'), extent: [[-180, -90], [180, 90]] },
      { id: 'form', title: 'Found a new launch?_form', created: at('2026-10-04'), extent: [[-2, 51], [-1, 52]] },
      { id: 'none', title: 'Weirs', created: at('2026-10-04') },
    ])
    expect(got.map(c => c.id)).toEqual(['in'])
    expect(got[0].url).toBe('https://www.arcgis.com/home/item.html?id=in')
  })

  it('suggests only new, water-related candidates not already known, once each, newest first', () => {
    const c = (id: string, title: string, created: string, extra: Partial<Candidate> = {}): Candidate =>
      ({ catalogue: 'ArcGIS Online', id, title, url: `https://x/${id}`, created, ...extra })
    const got = newCandidates([
      c('old', 'River weirs', '2026-09-01T00:00:00Z'),
      c('dry', 'Park gates', '2026-10-05T00:00:00Z'),
      c('crt', 'Locks', '2026-10-05T00:00:00Z', { url: 'https://services.arcgis.com/DknzyjEEie5tEW0u/x' }),
      c('canal', 'WACT Canal_WFL1', '2026-10-03T00:00:00Z'),
      c('weir', 'Weirs Adits', '2026-10-06T00:00:00Z'),
      c('weir', 'Weirs Adits', '2026-10-06T00:00:00Z'),
    ], since)
    expect(got.map(c => c.id)).toEqual(['weir', 'canal'])
  })

  it('the Netherlands: Dutch titles count, and the sources we already use stay out though the register re-harvests them', () => {
    const c = (id: string, title: string): Candidate => ({ catalogue: 'data.overheid.nl', id, title, url: `https://data.overheid.nl/dataset/${id}`, created: '2026-10-05T00:00:00Z' })
    expect(newCandidates([
      c('a', 'Kanoroutes Fryslân'), c('b', 'Stuwen waterschap Rivierenland'), c('c', 'Locaties sportvisserij: trailerhellingen'),
      c('d', 'FIS_VNDS - Lock - vlakken'), c('e', 'Waterschappen Kunstwerken IMWA'), c('f', 'Verdedigingslinies (punten)'),
    ], since).map(x => x.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('writes the digest as a checklist', () => {
    const body = digest([{ catalogue: 'OpenDataNI', id: 'x', title: 'Lough Erne canoe trail', url: 'https://u', publisher: 'DAERA', created: '2026-10-05T00:00:00Z', licence: 'OGL' }], since)
    expect(body).toContain('since 2026-10-01')
    expect(body).toContain('- [ ] [Lough Erne canoe trail](https://u) · OpenDataNI · DAERA · 2026-10-05 · OGL')
  })
})
