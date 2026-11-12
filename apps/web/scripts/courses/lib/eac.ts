// GoPro MAX 360 video as ffmpeg filter graphs. Pure; tested in eac.test.ts.
//
// The camera stores its 360 as two video streams, each three equi-angular cube
// faces side by side (left/front/right, then down/back/up). Each face is as wide
// as the stream is tall, and the outer faces carry some overlap: 4096x1344 has
// 32 px between faces (the original MAX at 5.6K), 3008x960 has 64 px (the newer
// clips in ~/Movies/Paddling/_inbox). Cropped and stacked 3x2 that's YouTube's
// EAC, which ffmpeg's v360=eac reads directly.

export type Layout = { face: number; step: number }

/** Where the faces sit in a stream of this size. */
export function eacLayout(width: number, height: number): Layout {
  const overlap = (width - 3 * height) / 2
  if (!Number.isInteger(overlap) || overlap < 0) throw new Error(`not a GoPro EAC stream: ${width}x${height}`)
  return { face: height, step: height + overlap }
}

/** The two streams as one EAC picture, split into `n` copies named [e0]…[e<n-1>]. Ends with ';'. */
export function eacGraph({ face, step }: Layout, n: number): string {
  const crop = (stream: number, i: number, name: string) => `[0:${stream}]crop=${face}:${face}:${i * step}:0[${name}]`
  const names = Array.from({ length: n }, (_, i) => `[e${i}]`).join('')
  return [crop(0, 0, 'l'), crop(0, 1, 'f'), crop(0, 2, 'r'), crop(4, 0, 'd'), crop(4, 1, 'b'), crop(4, 2, 'u')].join(';')
    + `;[l][f][r]hstack=3[top];[d][b][u]hstack=3[bot];[top][bot]vstack,split=${n}${names};`
}

/** v360 takes yaw in -180..180. */
export const wrapYaw = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180

export type Flat = { yaw: number; hFov: number; vFov: number; w: number; h: number; pitch?: number }

/** A flat (rectilinear) view of copy [e<i>], looking `yaw` degrees from the lens, written to [<out>]. */
export function flatView(i: number, out: string, v: Flat): string {
  return `[e${i}]v360=eac:flat:yaw=${wrapYaw(v.yaw)}:pitch=${v.pitch ?? 0}:h_fov=${v.hFov}:v_fov=${v.vFov}:w=${v.w}:h=${v.h}[${out}]`
}
