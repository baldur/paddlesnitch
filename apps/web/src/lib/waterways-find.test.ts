// Ends of a plan by name (#506, #508), on the Devizes–Westminster data.
import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { findOnWater, onWaterway } from '@paddlesnitch/waterways/find'
import { buildPlaces } from '@paddlesnitch/waterways/places'
import { snapClick } from '@paddlesnitch/waterways/plan'
import type { LatLng, RegionDataset } from '@paddlesnitch/waterways/types'

const dw: RegionDataset = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../packages/waterways/data/dw.json'), 'utf8'))
// Reading's centre, between the Thames and the Kennet.
const READING: LatLng = [51.4545, -0.9731]
const ds = { ...dw, places: buildPlaces([{ at: READING, tags: { place: 'town', name: 'Reading' } }], dw.features, dw.links) }

describe('finding an end by name', () => {
  it('finds a lock, on its waterway, with a point that snaps to it', () => {
    const [hit] = findOnWater(ds, 'Guyers Lock')
    expect(hit).toMatchObject({ kind: 'lock', waterway: 'Kennet and Avon Canal' })
    expect(snapClick(ds, hit.at)?.link.name).toBe('Kennet and Avon Canal')
  })

  it('finds a lock by its number', () => {
    expect(findOnWater(ds, 'Lock 84')[0]).toMatchObject({ name: 'Lock 84, Guyers Lock' })
  })

  it('finds a wharf, which the places index leaves out', () => {
    expect(findOnWater(ds, 'Aldermaston Wharf')[0]).toMatchObject({ name: 'Aldermaston Wharf', kind: 'wharf', waterway: 'Kennet and Avon Canal' })
  })

  it('gives a town by two waterways once for each', () => {
    const hits = findOnWater(ds, 'Reading').filter(h => h.name === 'Reading')
    expect(hits.map(h => h.waterway).sort()).toEqual(['River Kennet', 'River Thames'])
  })

  it('keeps to the waterway asked for', () => {
    expect(findOnWater(ds, 'Reading', { waterway: 'thames' }).map(h => h.waterway)).toEqual(['River Thames'])
  })

  it('reads "name, waterway" as both', () => {
    expect(findOnWater(ds, 'Reading, River Kennet').map(h => h.waterway)).toEqual(['River Kennet'])
    expect(findOnWater(ds, 'Guyers Lock, Kennet and Avon Canal')[0]).toMatchObject({ name: 'Lock 84, Guyers Lock' })
  })

  it('finds nothing for nonsense or nothing typed', () => {
    expect(findOnWater(ds, 'zzqx')).toEqual([])
    expect(findOnWater(ds, '  ')).toEqual([])
  })
})

describe('a point put onto a named waterway', () => {
  it('moves it onto that waterway when it runs close by, else says no', () => {
    const p = onWaterway(ds.links, READING, 'River Kennet')!
    expect(snapClick(ds, p)?.link.name).toBe('River Kennet')
    expect(onWaterway(ds.links, READING, 'Grand Union Canal')).toBeNull()
  })
})
