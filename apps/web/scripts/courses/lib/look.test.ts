import { describe, it, expect } from 'vitest'
import { decideCameraYaw, parseLook, placeItem } from './look'
import { bearing, haversine } from './stations'

describe('parseLook', () => {
  it('keeps a well-formed answer', () => {
    const l = parseLook(JSON.stringify({
      scene: 'Tree-lined canal with a moored narrowboat.', water: 'ripples', light: 'rain',
      own: { person: 'none', propulsion: 'none' },
      items: [{ kind: 'moored-narrowboat', detail: 'black hull, red trim, porthole windows', x: 0.5, distance: 'near', count: 1 }],
    }))
    expect(l?.items[0]).toEqual({ kind: 'moored-narrowboat', detail: 'black hull, red trim, porthole windows', x: 0.5, distance: 'near', count: 1 })
    expect(l?.light).toBe('rain')
  })

  it('clamps what is out of range and maps unknown words to safe values', () => {
    const l = parseLook(JSON.stringify({ scene: 's', water: 'stormy', light: 'x', own: {}, items: [{ kind: 'spaceship', detail: 7, x: 3, distance: 'very far', count: 0 }] }))
    expect(l?.water).toBe('unknown')
    expect(l?.own).toEqual({ person: 'none', propulsion: 'none' })
    expect(l?.items[0]).toEqual({ kind: 'other', detail: '', x: 1, distance: 'mid', count: 1 })
  })

  it('drops entries for things the model says it did not see', () => {
    const l = parseLook(JSON.stringify({ scene: 's', water: 'flat', light: 'sun', own: {}, items: [
      { kind: 'sign', detail: 'none visible', x: 0.5, distance: 'mid', count: 1 },
      { kind: 'swan', detail: 'Not visible in this view', x: 0.5, distance: 'mid', count: 1 },
      { kind: 'swan', detail: 'two adults by the bank', x: 0.3, distance: 'near', count: 2 },
    ] }))
    expect(l?.items.map((i) => i.detail)).toEqual(['two adults by the bank'])
  })

  it('counts an entry the model repeated only once', () => {
    const bridge = { kind: 'bridge', detail: 'concrete, far off', x: 0.5, distance: 'far', count: 1 }
    const l = parseLook(JSON.stringify({ scene: 's', water: 'flat', light: 'sun', own: {}, items: [bridge, bridge, bridge, { ...bridge, x: 0.6 }] }))
    expect(l?.items).toHaveLength(2)
  })

  it('rejects a reply that is not a look', () => {
    expect(parseLook('I see a river.')).toBeNull()
    expect(parseLook('{"scene":"no items"}')).toBeNull()
  })
})

describe('decideCameraYaw', () => {
  const kayak = (viewYaw: number, person: 'back' | 'face' | 'none') => ({ viewYaw, person, propulsion: person === 'none' ? 'none' as const : 'paddle' as const })

  it('a kayaker seen from behind at lens angle 180 means the lens looked back (the Reading clips)', () => {
    expect(decideCameraYaw([kayak(180, 'back'), kayak(180, 'back'), kayak(180, 'back'), kayak(0, 'none')])).toBe(180)
  })
  it('a kayaker seen face on means the bow is the other way', () => {
    expect(decideCameraYaw([kayak(0, 'face'), kayak(0, 'face'), kayak(0, 'face')])).toBe(180)
  })
  it('a rower faces the stern, so their back is towards the stern', () => {
    const rower = { viewYaw: 0, person: 'back' as const, propulsion: 'oars' as const }
    expect(decideCameraYaw([rower, rower, rower])).toBe(180)
  })
  it('waits for enough agreement', () => {
    expect(decideCameraYaw([kayak(180, 'back'), kayak(180, 'back')])).toBeNull()
    expect(decideCameraYaw([kayak(180, 'back'), kayak(180, 'back'), kayak(180, 'back'), kayak(90, 'back'), kayak(0, 'back')])).toBeNull()
  })
})

describe('placeItem', () => {
  const at = { lat: 51.4676, lng: -0.9822, heading: 270 } // paddling west

  it('the centre of the view at the bow is straight ahead', () => {
    const p = placeItem(at, 180, 180, { x: 0.5, distance: 'mid' })
    expect(p.bearing).toBeCloseTo(270, 6)
    expect(haversine(at, p)).toBeCloseTo(30, 3)
  })
  it('the view a quarter turn round the lens is to starboard', () => {
    const p = placeItem(at, 270, 180, { x: 0.5, distance: 'near' })
    expect(p.bearing).toBeCloseTo(0, 6) // west + 90 = north
    expect(p.lat).toBeGreaterThan(at.lat)
    expect(Math.abs(bearing(at, p) - 180)).toBeCloseTo(180, 0) // 0 or 360

  })
  it('the edge of the picture is half the field of view off centre', () => {
    expect(placeItem(at, 180, 180, { x: 1, distance: 'far' }).bearing).toBeCloseTo(270 + 50, 6)
    expect(placeItem(at, 180, 180, { x: 0, distance: 'far' }).bearing).toBeCloseTo(270 - 50, 6)
  })
})
