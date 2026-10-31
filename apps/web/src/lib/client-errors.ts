import { publicPath } from '@paddlesnitch/ui/metrics-events'

// The two error reports clients send (docs/features/observability.md,
// mobile/contract/telemetry.md) have fixed fields. Anything else is dropped,
// so a report can never carry user content: no exception messages from apps,
// no file paths, no free text beyond a browser error's first line.

const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined)
const VERSION = /^\d{1,4}(?:\.\d{1,4}){0,3}$/
const BUILD = /^\d{1,9}$/
// A stack frame from our own code: `com.paddlesnitch.paddles.PaddleScreen.render:212`
// or `PaddleScreen.render:212`. No slashes (paths), no spaces (messages).
const FRAME = /^[A-Za-z0-9_$.<>()-]{1,160}(?::\d{1,6})?$/
const MAX_FRAMES = 12

/** An app crash, sent on the next start. `appVersion`/`build` here are the
 *  version that CRASHED, which can be older than the one reporting it. */
export function crashReportProps(props: unknown): Record<string, string> | null {
  const p = (props && typeof props === 'object' ? props : {}) as Record<string, unknown>
  const type = str(p.type, 120)
  if (!type || !FRAME.test(type)) return null
  const frames = (typeof p.frames === 'string' ? p.frames.split('|') : [])
    .map(f => f.trim()).filter(f => FRAME.test(f)).slice(0, MAX_FRAMES)
  const appVersion = str(p.appVersion, 20)
  const build = str(p.build, 12)
  const os = str(p.os, 40)
  return {
    type,
    signature: frames.length ? `${type} @ ${frames[0]}` : type,
    ...(frames.length ? { frames: frames.join('|') } : {}),
    ...(appVersion && VERSION.test(appVersion) ? { crashedVersion: appVersion } : {}),
    ...(build && BUILD.test(build) ? { crashedBuild: build } : {}),
    ...(os && /^[A-Za-z0-9 ._-]+$/.test(os) ? { os } : {}),
  }
}

/** A browser error from our own scripts: its type, the first line of its
 *  message, and the page with personal segments replaced. */
export function clientErrorProps(props: unknown, path: unknown): Record<string, string> | null {
  const p = (props && typeof props === 'object' ? props : {}) as Record<string, unknown>
  const message = str(typeof p.message === 'string' ? p.message.split('\n')[0] : undefined, 120)
  if (!message) return null
  // An error's name (TypeError, DOMException), never free text: it's kept indefinitely.
  const type = typeof p.type === 'string' && /^[A-Za-z0-9_$.]{1,60}$/.test(p.type) ? p.type : undefined
  const page = typeof path === 'string' && path.startsWith('/') ? publicPath(path.slice(0, 200)) : undefined
  return { message, ...(type ? { type } : {}), ...(page ? { path: page } : {}) }
}
