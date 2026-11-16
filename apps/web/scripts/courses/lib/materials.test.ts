import { describe, it, expect } from 'vitest'
import { aimAt, combine, materialsModule, parseAnswer, type Answer } from './materials'

describe('parseAnswer', () => {
  it('reads a building seen, lower-cases its colours, and keeps an unseen roof as none', () => {
    expect(parseAnswer('{"visible":true,"wall_colour":"#8B4513","wall_material":"brick","roof_colour":null,"roof_material":null}'))
      .toEqual({ visible: true, wallColour: '#8b4513', wall: 'brick', roofColour: null, roof: null })
  })
  it("takes 'not visible' as an answer, and anything else (bad colour, a material not offered, not JSON) as none", () => {
    expect(parseAnswer('{"visible":false}')?.visible).toBe(false)
    expect(parseAnswer('{"visible":true,"wall_colour":"brown","wall_material":"brick","roof_colour":null,"roof_material":null}')).toBeNull()
    expect(parseAnswer('{"visible":true,"wall_colour":"#ffffff","wall_material":"glass","roof_colour":null,"roof_material":null}')).toBeNull()
    expect(parseAnswer('a brick house')).toBeNull()
  })
})

describe('aimAt', () => {
  const square: Array<[number, number]> = [[-5, -45], [5, -45], [5, -35], [-5, -35]] // 40 m north of the eye
  it('turns from the bow to the building, and widens the view to take it in', () => {
    const a = aimAt([0, 0], 90, square)! // going east: north is 270° round from the bow
    expect(a.fromBow).toBeCloseTo(270)
    expect(a.metres).toBeCloseTo(40)
    expect(a.hFov).toBeGreaterThanOrEqual(30)
  })
  it('skips a pass too near to see past a moored boat, or too far to tell anything', () => {
    expect(aimAt([0, -30], 0, square)).toBeNull()
    expect(aimAt([0, 60], 0, square)).toBeNull()
  })
})

describe('combine', () => {
  const seen = (wall: Answer['wall'], wallColour: string, roof: Answer['roof'] = null, roofColour: string | null = null): Answer => ({ visible: true, wall, wallColour, roof, roofColour })
  it("takes the commonest material and each colour's middle, leaving out views that didn't see it", () => {
    expect(combine([seen('brick', '#804020', 'tile', '#602010'), seen('brick', '#a06040'), seen('render', '#ffffff'), { ...seen('other', ''), visible: false }]))
      .toEqual({ wall: 'brick', wallColour: '#a06040', roof: null, roofColour: null })
    expect(combine([{ ...seen('other', ''), visible: false }])).toBeNull()
  })
  it('keeps a roof only where two views agree on it (one view saw sky or a balcony as a white metal roof)', () => {
    expect(combine([seen('brick', '#804020', 'tile', '#602010'), seen('brick', '#a06040', 'tile', '#402010')]))
      .toMatchObject({ roof: 'tile', roofColour: '#402010' })
    expect(combine([seen('brick', '#804020', 'tile', '#602010'), seen('brick', '#a06040', 'metal', '#ffffff')])).toMatchObject({ roof: null, roofColour: null })
    // Two of three agree: theirs, with its colour from those two only.
    expect(combine([seen('brick', '#804020', 'tile', '#602010'), seen('brick', '#a06040', 'metal', '#ffffff'), seen('brick', '#a06040', 'tile', '#402010')]))
      .toMatchObject({ roof: 'tile', roofColour: '#402010' })
  })
})

describe('materialsModule', () => {
  it('writes only the answers, by footprint middle, as a module the game imports', async () => {
    const src = materialsModule([[10.5, -20, '#a06040', 'brick', null, null]])
    expect(src).not.toMatch(/jpg|base64|frame/i)
    const { MATERIALS } = await import(`data:text/javascript,${encodeURIComponent(src)}`)
    expect(MATERIALS).toEqual([[10.5, -20, '#a06040', 'brick', null, null]])
  })
})
