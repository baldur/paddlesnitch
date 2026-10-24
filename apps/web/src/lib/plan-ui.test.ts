// The planner page's wording and address-bar state (plan-ui.ts).
import { describe, expect, it } from 'vitest'
import type { Stop } from '@paddlesnitch/waterways/plan'
import type { Feature, LatLng } from '@paddlesnitch/waterways/types'
import type { PortageOnRoute } from '@paddlesnitch/waterways/portage'
import { lineLength } from '@paddlesnitch/waterways/line'
import { addPortageHref, aerialPhotoUrl, farEndLabel, planSummaryText, regulatedKayakRivers, lockFromParams, portageMap, daylightSummary, isDarkStop, crewLines, isCrewStop, printHref, shownGroups, asInput, draftFromParams, draftParams, groupOf, localInput, mapTiles, gaugeValueText, inAustria, inFrance, inNetherlands, inSwitzerland, nearFlanders, germanPhotosNear, GERMAN_PHOTOS, FLANDERS_PHOTOS, printablePhotos, pixelsToMetres, placeClick, stopId, stopLines, type PlanDraft } from './plan-ui'

const feature = (over: Partial<Feature>): Feature => ({
  id: 'x', kind: 'lock', name: 'Cookham Lock', at: [51.56, -0.71],
  source: { source: 'ea-thames-locks', fetchedAt: '2026-10-11T00:00:00Z' }, ...over,
})
const stop = (f: Feature, over: Partial<Stop> = {}): Stop => ({
  feature: f, leg: 'out', chainageM: 1000, fromPrevM: 1000, portage: f.kind === 'lock',
  portagesBefore: 0, elapsedS: 450, ...over,
})

describe("a stop's id in the page (#510)", () => {
  it('is its leg and feature id, safe to use as an HTML id', () => {
    expect(stopId(stop(feature({ id: 'crt:locks:OX-076-001' })))).toBe('stop-out-crt-locks-OX-076-001')
    expect(stopId(stop(feature({ id: 'crt:locks:OX-076-001' }), { leg: 'back' }))).toBe('stop-back-crt-locks-OX-076-001')
  })
})

describe('what a stop says', () => {
  it("says a lock's portage side is unknown rather than guessing one", () => {
    expect(stopLines(stop(feature({}))) ).toContain('Portage side not known yet.')
    expect(stopLines(stop(feature({ portage: { side: 'left', carryM: 82 } })))).toEqual(
      expect.arrayContaining(['Portage on the left bank.', 'Carry about 82 m.']),
    )
  })

  it("says a canal's bywash weir is beside the way, with nothing to portage (#509)", () => {
    const weir = feature({ kind: 'weir', name: 'Weir 21' })
    expect(stopLines(stop(weir, { beside: true }))).toContain('Beside the canal, not across it: nothing to portage.')
    expect(stopLines(stop(weir))).not.toContain('Beside the canal, not across it: nothing to portage.')
  })

  it('gives a crew how to get there, where to park, the postcode and facilities', () => {
    const lines = stopLines(stop(feature({
      lock: { postcode: 'SL6 9SR', facilities: ['toilet', 'drinking_water'] },
      crew: { directions: 'Walk across the weir from the car park.', parking: 'National Trust car park.' },
    })))
    expect(lines).toEqual([
      'Portage side not known yet.',
      'Walk across the weir from the car park.',
      'Parking: National Trust car park.',
      'Postcode SL6 9SR.',
      'Facilities: toilet, drinking water.',
    ])
  })

  it('says which bank a towpath access point is on, in the direction of travel', () => {
    const f = feature({ kind: 'crew_point', name: 'Towpath access', crew: { directions: 'Steps, 1.2 m wide.' } })
    expect(stopLines(stop(f, { bank: 'right' }))).toEqual(['On the right bank.', 'Steps, 1.2 m wide.'])
  })

  it('groups kinds for the filters', () => {
    expect(['lock', 'portage', 'weir', 'slipway', 'access', 'facility', 'crew_point'].map(k => groupOf(k as Feature['kind'])))
      .toEqual(['portage', 'portage', 'weir', 'access', 'access', 'facility', 'crew'])
  })
})

describe('an unsaved plan in the address bar', () => {
  const draft: PlanDraft = {
    start: [51.355333, -1.994961], finish: [51.500833, -0.121667], shape: 'return',
    startAt: '2027-04-17T07:00:00.000Z', paceKmh: 9.5, portageMinutes: 4,
  }

  it('round-trips', () => {
    const q = draftParams(draft)
    expect(q).toBe('from=51.355333,-1.994961&to=51.500833,-0.121667&shape=return&at=2027-04-17T07:00:00.000Z&pace=9.5&portage=4')
    expect(draftFromParams(Object.fromEntries(new URLSearchParams(q))).draft).toEqual(draft)
  })

  it('leaves defaults out, and fills them back in', () => {
    const plain: PlanDraft = { start: null, finish: null, shape: 'one_way', paceKmh: 8, portageMinutes: 3 }
    expect(draftParams(plain)).toBe('')
    expect(draftFromParams({}).draft).toEqual(plain)
  })

  it('ignores nonsense', () => {
    const { draft: d, view } = draftFromParams({ from: '91,0', to: 'abc', pace: '-4', portage: '999', at: 'soon', view: '1,2' })
    expect(d).toEqual({ start: null, finish: null, shape: 'one_way', paceKmh: 1, portageMinutes: 120, startAt: undefined })
    expect(view).toBeUndefined()
    expect(draftFromParams({ view: '51.45,-0.95,15' }).view).toEqual({ at: [51.45, -0.95], zoom: 15 })
  })

  it('is a plan only with both ends', () => {
    expect(asInput({ ...draft, finish: null })).toBeNull()
    expect(asInput(draft)).toMatchObject({ start: draft.start, finish: draft.finish })
  })
})

describe('clicks', () => {
  it('ten pixels on the map is tens of metres at zoom 14, less closer in and further north', () => {
    expect(pixelsToMetres(0, 14)).toBeCloseTo(95.5, 0)
    expect(pixelsToMetres(52, 14)).toBeCloseTo(58.8, 0)
    expect(pixelsToMetres(52, 16)).toBeCloseTo(pixelsToMetres(52, 14) / 4, 6)
  })

  const empty: PlanDraft = { start: null, finish: null, shape: 'one_way', paceKmh: 8, portageMinutes: 3 }
  it('set the start, then the finish, then move whichever end is nearer', () => {
    const a = placeClick(empty, [51.0, -1.0])
    expect(a.start).toEqual([51.0, -1.0])
    const b = placeClick(a, [51.0, -0.5])
    expect(b.finish).toEqual([51.0, -0.5])
    expect(placeClick(b, [51.0, -0.9]).start).toEqual([51.0, -0.9])
    expect(placeClick(b, [51.0, -0.6]).finish).toEqual([51.0, -0.6])
  })

  it('move an end that missed the water, so a bad click can be fixed by clicking again', () => {
    // The start landed in a field: the next click moves it, instead of becoming the finish.
    const missed = placeClick(empty, [51.32, -1.2])
    expect(placeClick(missed, [51.0, -1.0], 'start')).toMatchObject({ start: [51.0, -1.0], finish: null })
    const both: PlanDraft = { ...empty, start: [51.0, -1.0], finish: [51.32, -1.2] }
    expect(placeClick(both, [51.0, -0.5], 'finish')).toMatchObject({ start: [51.0, -1.0], finish: [51.0, -0.5] })
  })
})

describe('the start time box', () => {
  it("shows an ISO time in the browser's zone", () => {
    const local = new Date(2027, 3, 17, 8, 5)
    expect(localInput(local.toISOString())).toBe('2027-04-17T08:05')
    expect(localInput(undefined)).toBe('')
  })
})

describe('a gauge reading in words', () => {
  it('a level in metres (NAP for Dutch gauges), a flow in m³/s where that is all a source gives, else none', () => {
    expect(gaugeValueText({ valueM: 1.234 })).toBe('1.23 m')
    expect(gaugeValueText({ valueM: -0.5, datum: 'nap' })).toBe('-0.50 m NAP')
    expect(gaugeValueText({ flowM3s: 19.4 })).toBe('19.4 m³/s')
    expect(gaugeValueText({})).toBeNull()
  })
})

describe('the map tiles', () => {
  it('switches to Esri aerial imagery, with labels that read on a photo and the imagery credited', () => {
    const sat = mapTiles(true)
    expect(sat.base).toContain('/World_Imagery/')
    expect(sat.labels).toContain('/World_Boundaries_and_Places/')
    expect(sat.attribution).toContain('Esri, Vantor, Earthstar Geographics')
    expect(sat.baseNativeZoom).toBe(19)   // close enough to see a landing stage
  })

  it("over the Netherlands, the Kadaster's 8 cm aerial photos (printable, CC BY 4.0), credited", () => {
    const nl = mapTiles(true, 'nl')
    expect(nl.base).toContain('service.pdok.nl/hwh/luchtfotorgb')
    expect(nl.attribution).toContain('Beeldmateriaal.nl (Kadaster), CC BY 4.0')
    expect(mapTiles(false, 'nl').base).toContain('/World_Dark_Gray_Base/')   // only the satellite view changes
  })

  it("over France, IGN's BD ORTHO aerial photos (printable, Licence Ouverte 2.0), credited", () => {
    const fr = mapTiles(true, 'fr')
    expect(fr.base).toContain('data.geopf.fr/wmts')
    expect(fr.base).toContain('LAYER=ORTHOIMAGERY.ORTHOPHOTOS')
    expect(fr.base).toContain('TILEMATRIXSET=PM')
    expect(fr.base).toContain('FORMAT=image/jpeg')   // the only format it serves
    expect(fr.baseNativeZoom).toBe(19)
    expect(fr.attribution).toContain('IGN, BD ORTHO, Licence Ouverte 2.0')
    expect(mapTiles(false, 'fr').base).toContain('/World_Dark_Gray_Base/')
  })

  it("over Switzerland swisstopo's SWISSIMAGE, over Austria basemap.at's orthophotos, each credited; both replace Esri (white or foreign imagery beyond)", () => {
    expect(mapTiles(true, 'ch')).toMatchObject({ base: expect.stringContaining('wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage'), attribution: expect.stringContaining('swisstopo') })
    expect(mapTiles(true, 'at')).toMatchObject({ base: expect.stringContaining('maps.wien.gv.at/basemap/bmaporthofoto30cm'), attribution: expect.stringContaining('basemap.at') })
    const inside = (f: (p: [number, number]) => boolean, pts: Record<string, number[]>) => Object.entries(pts).filter(([, p]) => !f(p as [number, number])).map(([n]) => n)
    const outside = (f: (p: [number, number]) => boolean, pts: Record<string, number[]>) => Object.entries(pts).filter(([, p]) => f(p as [number, number])).map(([n]) => n)
    expect(inside(inSwitzerland, { Bern: [46.95, 7.45], Zürich: [47.37, 8.54], Lausanne: [46.52, 6.63], Luzern: [47.05, 8.31], Chur: [46.85, 9.53], Sion: [46.23, 7.36], Interlaken: [46.69, 7.86] })).toEqual([])
    expect(outside(inSwitzerland, { Freiburg: [47.99, 7.85], Milan: [45.46, 9.19], Annecy: [45.9, 6.13], Vaduz: [47.14, 9.52], Innsbruck: [47.27, 11.39], Konstanz: [47.67, 9.18] })).toEqual([])
    expect(inside(inAustria, { Vienna: [48.21, 16.37], Linz: [48.31, 14.29], Innsbruck: [47.27, 11.39], Graz: [47.07, 15.44], Melk: [48.23, 15.33], Klagenfurt: [46.62, 14.31], Salzburg: [47.80, 13.04] })).toEqual([])
    expect(outside(inAustria, { Munich: [48.14, 11.58], Brno: [49.19, 16.6], Ljubljana: [46.05, 14.5], Verona: [45.44, 10.99], Zürich: [47.37, 8.54], Vaduz: [47.14, 9.52], Freilassing: [47.84, 12.98] })).toEqual([])
    expect(printablePhotos([46.95, 7.45])).toBe('ch')
    expect(printablePhotos([48.21, 16.37])).toBeUndefined()   // basemap.at has no WMS: on screen only
    expect(new URL(aerialPhotoUrl({ bbox: [46.93, 7.44, 46.94, 7.45] }, 'ch')).searchParams.get('LAYERS')).toBe('ch.swisstopo.swissimage')
  })

  it('knows France from its neighbours, Corsica included', () => {
    const inside = { Paris: [48.857, 2.352], Lille: [50.63, 3.06], Strasbourg: [48.58, 7.75], Lyon: [45.76, 4.84], Marseille: [43.30, 5.37], Toulouse: [43.60, 1.44],
      Bordeaux: [44.84, -0.58], Brest: [48.39, -4.49], 'Vallon-Pont-d’Arc': [44.40, 4.39], Chamonix: [45.92, 6.87], Ajaccio: [41.93, 8.74] }
    const outside = { Brussels: [50.85, 4.35], Namur: [50.47, 4.87], Luxembourg: [49.61, 6.13], Saarbrücken: [49.23, 7.0], Geneva: [46.20, 6.14], Lausanne: [46.52, 6.63],
      Turin: [45.07, 7.69], 'San Sebastián': [43.32, -1.98], Andorra: [42.51, 1.52], 'St Helier': [49.19, -2.11], Dover: [51.13, 1.31], London: [51.5, -0.12], Sardinia: [40.9, 9.1] }
    expect(Object.entries(inside).filter(([, p]) => !inFrance(p as [number, number])).map(([n]) => n)).toEqual([])
    expect(Object.entries(outside).filter(([, p]) => inFrance(p as [number, number])).map(([n]) => n)).toEqual([])
  })

  it('knows the Netherlands from its neighbours', () => {
    expect([[52.37, 4.90], [51.92, 4.48], [53.22, 6.57], [50.85, 5.69]].map(p => inNetherlands(p as [number, number]))).toEqual([true, true, true, true])   // Amsterdam, Rotterdam, Groningen, Maastricht
    expect([[51.22, 4.40], [51.45, 7.0], [51.5, -0.12], [52.6, 3.0]].map(p => inNetherlands(p as [number, number]))).toEqual([false, false, false, false])   // Antwerp, Essen, London, North Sea
  })

  it('near Flanders the Flemish orthophotos go over Esri (transparent outside Flanders), credited', () => {
    expect([[51.054, 3.717], [50.847, 4.353], [51.21, 4.40]].map(p => nearFlanders(p as [number, number]))).toEqual([true, true, true])   // Ghent, Brussels, Antwerp
    expect([[50.467, 4.868], [52.37, 4.90], [51.5, -0.12]].map(p => nearFlanders(p as [number, number]))).toEqual([false, false, false])   // Namur, Amsterdam, London
    expect(FLANDERS_PHOTOS.url).toContain('TILEMATRIXSET=GoogleMapsVL')
    expect(FLANDERS_PHOTOS.attribution).toContain('Vlaamse Open Data licentie')
  })

  it('printable photos: the Kadaster in the Netherlands, Digitaal Vlaanderen in Flanders, IGN in France, none in Wallonia or the UK', () => {
    expect([[52.37, 4.90], [51.054, 3.717], [51.21, 4.40], [50.847, 4.353], [50.467, 4.868], [50.19, 5.0], [51.5, -0.12], [48.857, 2.352], [50.63, 3.06]]
      .map(p => printablePhotos(p as [number, number]))).toEqual(['nl', 'vl', 'vl', 'vl', undefined, undefined, undefined, 'fr', 'fr'])   // Amsterdam, Ghent, Antwerp, Brussels, Namur, the Lesse, London, Paris, Lille
  })

  it('German states publish their own aerial photos: NRW and Berlin (both DL-DE Zero), over Esri near them, printed inside them', () => {
    const where = (pts: Record<string, number[]>) => Object.fromEntries(Object.entries(pts).map(([n, p]) => [n, printablePhotos(p as [number, number]) ?? null]))
    expect(where({ Cologne: [50.94, 6.96], Dortmund: [51.51, 7.47], Münster: [51.96, 7.63], Bielefeld: [52.02, 8.53], Siegen: [50.87, 8.02] }))
      .toEqual({ Cologne: 'nw', Dortmund: 'nw', Münster: 'nw', Bielefeld: 'nw', Siegen: 'nw' })
    expect(where({ Alexanderplatz: [52.52, 13.41], Spandau: [52.535, 13.2], Köpenick: [52.445, 13.575] })).toEqual({ Alexanderplatz: 'be', Spandau: 'be', Köpenick: 'be' })
    expect(where({ Osnabrück: [52.27, 8.05], Koblenz: [50.36, 7.59], Kassel: [51.31, 9.49], Maastricht: [50.85, 5.69] }))
      .toEqual({ Osnabrück: null, Koblenz: null, Kassel: 'he', Maastricht: 'nl' })   // Kassel is in Hessen
    expect(printablePhotos([51.37, 6.17])).toBe('nl')   // Venlo: the Dutch outline used to stop ~7 km short of it
    expect(printablePhotos([51.34, 6.14])).toBe('nl')   // Tegelen
    expect(printablePhotos([51.32, 6.20])).not.toBe('nl')   // Kaldenkirchen, just over the border in Germany
    expect(germanPhotosNear([50.94, 6.96]).map(g => g.id)).toEqual(['nw'])
    expect(germanPhotosNear([52.52, 13.41]).map(g => g.id)).toEqual(['be', 'bb'])   // Berlin's own first, then Brandenburg's
    expect(germanPhotosNear([51.5, 10.5])).toEqual([])   // the Harz: none yet
    // Every one credits an open licence, or (M-V: "no conditions" but a credit) the credit its service requires.
    expect(GERMAN_PHOTOS.filter(g => !/Datenlizenz Deutschland|dl-de\/|CC BY|© GeoBasis-DE\//.test(g.attribution)).map(g => g.id)).toEqual([])
  })

  it('Brandenburg (DL-DE BY 2.0) round Berlin, and Bavaria (CC BY 4.0), the same way; Berlin keeps its own sharper photos', () => {
    const where = (pts: Record<string, number[]>) => Object.fromEntries(Object.entries(pts).map(([n, p]) => [n, printablePhotos(p as [number, number]) ?? null]))
    expect(where({ Potsdam: [52.39, 13.06], Bernau: [52.68, 13.59], 'Frankfurt (Oder)': [52.34, 14.55], Cottbus: [51.76, 14.33], Brandenburg: [52.41, 12.55], Alexanderplatz: [52.52, 13.41] }))
      .toEqual({ Potsdam: 'bb', Bernau: 'bb', 'Frankfurt (Oder)': 'bb', Cottbus: 'bb', Brandenburg: 'bb', Alexanderplatz: 'be' })
    expect(where({ Munich: [48.14, 11.58], Nuremberg: [49.45, 11.08], Passau: [48.57, 13.46], Würzburg: [49.79, 9.93], Regensburg: [49.01, 12.10], Bamberg: [49.89, 10.89] }))
      .toEqual({ Munich: 'by', Nuremberg: 'by', Passau: 'by', Würzburg: 'by', Regensburg: 'by', Bamberg: 'by' })
    expect(where({ Magdeburg: [52.13, 11.63], Dresden: [51.05, 13.74], Szczecin: [53.43, 14.55], Salzburg: [47.8, 13.04], Innsbruck: [47.27, 11.39], Pilsen: [49.74, 13.38], Erfurt: [50.98, 11.03], Frankfurt: [50.11, 8.68] }))
      .toEqual({ Magdeburg: null, Dresden: null, Szczecin: null, Salzburg: null, Innsbruck: null, Pilsen: null, Erfurt: null, Frankfurt: 'he' })
    expect(new URL(aerialPhotoUrl({ bbox: [48, 11, 48.01, 11.01] }, 'by')).searchParams.get('LAYERS')).toBe('by_dop40c')
    expect(GERMAN_PHOTOS.find(g => g.id === 'bb')!.attribution).toContain('GeoBasis-DE/LGB, dl-de/by-2-0')
  })

  it('Hessen (DL-DE Zero) the same way, with the layer that draws at every zoom', () => {
    const where = (pts: Record<string, number[]>) => Object.fromEntries(Object.entries(pts).map(([n, p]) => [n, printablePhotos(p as [number, number]) ?? null]))
    expect(where({ Frankfurt: [50.11, 8.68], Kassel: [51.31, 9.49], Darmstadt: [49.87, 8.65], Fulda: [50.55, 9.68], Gießen: [50.58, 8.68], Marburg: [50.81, 8.77] }))
      .toEqual({ Frankfurt: 'he', Kassel: 'he', Darmstadt: 'he', Fulda: 'he', Gießen: 'he', Marburg: 'he' })
    expect(where({ Mannheim: [49.49, 8.47], Siegen: [50.87, 8.02], Göttingen: [51.53, 9.93], Koblenz: [50.36, 7.59], Erfurt: [50.98, 11.03] }))
      .toEqual({ Mannheim: null, Siegen: 'nw', Göttingen: null, Koblenz: null, Erfurt: null })
    expect(printablePhotos([49.79, 9.93])).toBe('by')   // Würzburg
    expect(GERMAN_PHOTOS.find(g => g.id === 'he')!.layers).toBe('he_dop_rgb')   // he_dop20_rgb is blank when zoomed out
  })

  it('Mecklenburg-Western Pomerania (credit © GeoBasis-DE/M-V) and Baden-Württemberg (DL-DE BY 2.0) the same way', () => {
    const where = (pts: Record<string, number[]>) => Object.fromEntries(Object.entries(pts).map(([n, p]) => [n, printablePhotos(p as [number, number]) ?? null]))
    expect(where({ Schwerin: [53.63, 11.41], Rostock: [54.09, 12.1], 'Waren (Müritz)': [53.52, 12.68], Neubrandenburg: [53.56, 13.26], Stralsund: [54.31, 13.09], Greifswald: [54.09, 13.38] }))
      .toEqual({ Schwerin: 'mv', Rostock: 'mv', 'Waren (Müritz)': 'mv', Neubrandenburg: 'mv', Stralsund: 'mv', Greifswald: 'mv' })
    expect(where({ Stuttgart: [48.78, 9.18], Heilbronn: [49.14, 9.22], Freiburg: [47.99, 7.85], Karlsruhe: [49.01, 8.40], Heidelberg: [49.40, 8.69], Tübingen: [48.52, 9.06] }))
      .toEqual({ Stuttgart: 'bw', Heilbronn: 'bw', Freiburg: 'bw', Karlsruhe: 'bw', Heidelberg: 'bw', Tübingen: 'bw' })
    expect(where({ Lübeck: [53.87, 10.69], Hamburg: [53.55, 9.99], Neuruppin: [52.93, 12.8], Prenzlau: [53.32, 13.86], Strasbourg: [48.58, 7.75], Zürich: [47.37, 8.54], Speyer: [49.32, 8.43] }))
      .toEqual({ Lübeck: null, Hamburg: null, Neuruppin: 'bb', Prenzlau: 'bb', Strasbourg: 'fr', Zürich: 'ch', Speyer: null })
    expect(GERMAN_PHOTOS.find(g => g.id === 'mv')!.attribution).toContain('© GeoBasis-DE/M-V')
    expect(GERMAN_PHOTOS.find(g => g.id === 'mv')).toMatchObject({ tileSize: 512 })   // its watermark, a quarter as often
    expect(GERMAN_PHOTOS.find(g => g.id === 'bw')!.attribution).toContain('LGL-BW')
  })

  it('is the dark map by default', () => {
    expect(mapTiles(false).base).toContain('/World_Dark_Gray_Base/')
  })
})

describe('the printed sheets', () => {
  const draft: PlanDraft = { start: [51.355333, -1.994961], finish: [51.500833, -0.121667], shape: 'one_way', paceKmh: 8, portageMinutes: 3 }

  it('carry the route, the plan behind it, the sheet and the stop kinds in the address', () => {
    expect(printHref(draft)).toBe('/plan/print?from=51.355333,-1.994961&to=51.500833,-0.121667')
    expect(printHref(draft, { id: 'abc', crew: true, show: ['portage', 'weir'] }))
      .toBe('/plan/print?from=51.355333,-1.994961&to=51.500833,-0.121667&show=portage,weir&id=abc&crew=1')
    expect(printHref(draft, { share: 'xyz' })).toContain('&share=xyz')
  })

  it("read the stop kinds back, ignoring ones that don't exist; none asked means the defaults", () => {
    expect([...shownGroups('portage,weir,nonsense')]).toEqual(['portage', 'weir'])
    expect([...shownGroups('')]).toEqual([])
    expect([...shownGroups(undefined)]).toEqual(['portage', 'weir', 'access', 'facility'])
  })

  it('the crew sheet keeps places a crew can reach, with postcode and parking; not towpath points', () => {
    const lock = feature({ crew: { postcode: 'SL6 9SR', parking: 'National Trust car park.', directions: 'Walk across the weir.' } })
    expect(isCrewStop(stop(lock))).toBe(true)
    expect(crewLines(stop(lock))).toEqual({ postcode: 'SL6 9SR', lines: ['Parking: National Trust car park.', 'Walk across the weir.'] })
    expect(isCrewStop(stop(feature({})))).toBe(false)                                      // a lock we can't direct anyone to
    expect(isCrewStop(stop(feature({ kind: 'slipway', name: 'Slipway' })))).toBe(true)
    expect(isCrewStop(stop(feature({ kind: 'crew_point', name: 'Towpath access' })))).toBe(false)
  })
})

describe('daylight', () => {
  const lock = feature({ at: [51.5, -0.9] })
  it('marks a stop reached before sunrise or after sunset; without a start time, nothing', () => {
    expect(isDarkStop(stop(lock, { eta: '2027-04-17T02:00:00.000Z' }))).toBe(true)
    expect(isDarkStop(stop(lock, { eta: '2027-04-17T12:00:00.000Z' }))).toBe(false)
    expect(isDarkStop(stop(lock))).toBe(false)
  })

  it('gives sunrise and sunset on the start day, and counts the stops in the dark', () => {
    const plan = {
      start: { at: [51.5, -0.9] as [number, number], waterway: 'River Thames' }, finish: { at: [51.5, -0.9] as [number, number], waterway: 'River Thames' },
      line: [], lengthM: 0, portages: 0, movingS: 0, totalS: 0, waterways: [],
      stops: [stop(lock, { eta: '2027-04-17T02:00:00.000Z' }), stop(lock, { eta: '2027-04-17T12:00:00.000Z' })],
    }
    const d = daylightSummary(plan, '2027-04-17T02:00:00.000Z')!
    expect(d.darkStops).toBe(1)
    expect(Date.parse(d.sunrise!)).toBeLessThan(Date.parse(d.sunset!))
    expect(daylightSummary(plan, undefined)).toBeNull()
  })
})

describe('adding portage details from a link', () => {
  it('round-trips a lock through the address, and refuses junk', () => {
    const href = addPortageHref({ id: 'ea-lock:hambleden', name: 'Hambleden Lock', at: [51.5604, -0.8687] })
    expect(href).toBe('/plan?lock=ea-lock:hambleden&lockAt=51.560400,-0.868700&lockName=Hambleden+Lock&view=51.560400,-0.868700,18')
    const params = Object.fromEntries(new URLSearchParams(href.split('?')[1]))
    expect(lockFromParams(params)).toEqual({ id: 'ea-lock:hambleden', name: 'Hambleden Lock', at: [51.5604, -0.8687] })
    expect(lockFromParams({ lock: 'x', lockAt: 'nowhere' })).toBeUndefined()
    expect(lockFromParams({ lockAt: '51,0' })).toBeUndefined()
  })
})

describe('portage maps for the printed sheet', () => {
  // A straight route heading east through a lock at [51.5, -0.995], landings on the north bank.
  const line: LatLng[] = [[51.5, -1.01], [51.5, -0.98]]
  const lock = { id: 'l', kind: 'lock' as const, at: [51.5, -0.995] as LatLng, source: { source: 'crt' as const, fetchedAt: '2026-10-19T00:00:00Z' } }
  const portage: PortageOnRoute = {
    id: 'p', by: 'Ann', carryM: 70,
    takeOut: { at: [51.5002, -0.9955], bank: 'left' }, putIn: { at: [51.5002, -0.9945], bank: 'left' },
  }
  const len = lineLength(line)
  const chainage = len / 2   // the lock is halfway

  it('centres on the lock, north up: the bank to your left heading east is above the line', () => {
    const map = portageMap(line, { chainageM: chainage, leg: 'out', feature: lock }, portage)
    expect(map.lock).toEqual([110, 110])
    expect(map.takeOut![1]).toBeLessThan(110)
    expect(map.takeOut![0]).toBeLessThan(map.putIn![0])
    expect(map.route.startsWith('M')).toBe(true)
  })

  it('points the arrow the way you go, upstream of the lock, and on the way back reverses it', () => {
    const out = portageMap(line, { chainageM: chainage, leg: 'out', feature: lock }, portage)
    expect(out.arrow.deg).toBe(90)
    expect(out.arrow.x).toBeLessThan(110)
    const back = portageMap(line, { chainageM: 2 * len - chainage, leg: 'back', feature: lock }, portage)
    expect(back.arrow.deg).toBe(270)
    expect(back.arrow.x).toBeGreaterThan(110)
  })

  it("a lock with no landings yet is drawn 120 m round, ready for the Kadaster's photo behind it, exactly its extent", () => {
    const map = portageMap(line, { chainageM: chainage, leg: 'out', feature: lock })
    expect(map.takeOut).toBeUndefined()
    const [s, w, n, e] = map.bbox
    expect((n - s) * 110_540 / 2).toBeCloseTo(120, 0)                                   // 120 m from the lock to the edge
    expect((e - w) * Math.cos((51.5 * Math.PI) / 180) * 111_320 / 2).toBeCloseTo(120, 0)  // and square on the ground
    expect(new URL(aerialPhotoUrl(map, 'vl')).searchParams.get('LAYERS')).toBe('Ortho')
    expect(new URL(aerialPhotoUrl(map, 'nw')).searchParams.get('LAYERS')).toBe('nw_dop_rgb')
    expect(new URL(aerialPhotoUrl(map, 'be')).hostname).toBe('gdi.berlin.de')
    const fr = new URL(aerialPhotoUrl(map, 'fr'))
    expect([fr.hostname, fr.searchParams.get('LAYERS')]).toEqual(['data.geopf.fr', 'ORTHOIMAGERY.ORTHOPHOTOS'])
    const url = new URL(aerialPhotoUrl(map))
    expect(url.hostname).toBe('service.pdok.nl')
    expect(url.searchParams.get('CRS')).toBe('EPSG:4326')
    expect(url.searchParams.get('BBOX')).toBe(map.bbox.map(v => v.toFixed(6)).join(','))   // WMS 1.3 with EPSG:4326: latitude first
  })

  it('a round-number scale bar about a quarter of the width', () => {
    const { scale, size } = portageMap(line, { chainageM: chainage, leg: 'out', feature: lock }, portage)
    expect([10, 20, 25, 50, 100]).toContain(scale.m)
    expect(scale.px).toBeGreaterThan(size / 8)
    expect(scale.px).toBeLessThanOrEqual(size / 4)
  })
})

describe("Wallonia's regulated kayak rivers", () => {
  it('names the regulated rivers a plan paddles, whatever the article or accents; canals and side streams aren\'t', () => {
    expect(regulatedKayakRivers(['La Lesse', "L'Ourthe", 'Amblève', 'Meuse', 'Lesse'])).toEqual(['the Lesse', 'the Ourthe', 'the Amblève'])
    expect(regulatedKayakRivers(["Canal de l'Ourthe", 'La Houillette', 'Lesse souterraine', 'River Thames'])).toEqual([])
    expect(regulatedKayakRivers(["L'Ourthe orientale", 'la Semois', 'La Sûre'])).toEqual(['the Ourthe orientale', 'the Semois', 'the Sûre'])
  })
})

describe('the far end’s name (#630)', () => {
  it('is Finish on a one-way trip and Turn at on a return trip', () => {
    expect(farEndLabel('one_way')).toBe('Finish')
    expect(farEndLabel('return')).toBe('Turn at')
  })
})

describe('planSummaryText (#513)', () => {
  const stops = (n: number) => Array.from({ length: n + 1 }, (_, i) => ({ portage: i < n }))
  it('says distance, shape, portages and the waterways', () => {
    expect(planSummaryText({ lengthM: 13_640, stops: stops(6), waterways: ['Oxford Canal'] }, 'return')).toBe('13.6 km return, 6 portages, Oxford Canal')
    expect(planSummaryText({ lengthM: 5_000, stops: stops(1), waterways: ['River Kennet', 'Kennet and Avon Canal', 'River Thames'] }, 'one_way')).toBe('5.0 km one-way, 1 portage, River Kennet and Kennet and Avon Canal')
    expect(planSummaryText({ lengthM: 2_000, stops: [] }, 'one_way')).toBe('2.0 km one-way, no portages')
  })
})
