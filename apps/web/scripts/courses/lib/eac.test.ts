import { describe, it, expect } from 'vitest'
import { eacLayout, eacGraph, flatView, wrapYaw } from './eac'

describe('eacLayout', () => {
  it('finds the 32 px overlap in the original MAX 5.6K stream', () => {
    expect(eacLayout(4096, 1344)).toEqual({ face: 1344, step: 1376 })
  })
  it('finds the 64 px overlap in the newer 3008x960 clips', () => {
    expect(eacLayout(3008, 960)).toEqual({ face: 960, step: 1024 })
  })
  it('refuses a stream that is not three faces wide', () => {
    expect(() => eacLayout(1920, 1080)).toThrow(/not a GoPro EAC/)
  })
})

describe('eacGraph', () => {
  it('crops the six faces at the layout offsets and splits the picture', () => {
    const g = eacGraph({ face: 1344, step: 1376 }, 2)
    // The same graph frames.ts used when the offsets were written out by hand.
    expect(g).toBe('[0:0]crop=1344:1344:0:0[l];[0:0]crop=1344:1344:1376:0[f];[0:0]crop=1344:1344:2752:0[r];'
      + '[0:4]crop=1344:1344:0:0[d];[0:4]crop=1344:1344:1376:0[b];[0:4]crop=1344:1344:2752:0[u];'
      + '[l][f][r]hstack=3[top];[d][b][u]hstack=3[bot];[top][bot]vstack,split=2[e0][e1];')
  })
})

describe('flatView', () => {
  it('wraps the yaw into v360 range', () => {
    expect(wrapYaw(270)).toBe(-90)
    expect(wrapYaw(180)).toBe(-180)
    expect(flatView(1, 'left', { yaw: 270, hFov: 100, vFov: 62, w: 1024, h: 640, pitch: 5 }))
      .toBe('[e1]v360=eac:flat:yaw=-90:pitch=5:h_fov=100:v_fov=62:w=1024:h=640[left]')
  })
})
