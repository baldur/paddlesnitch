// course:look's command line. Pure; tested in look-args.test.ts. A misspelt flag
// or a bad number is an error, never silently a folder or a default.

export type LookArgs = {
  mode: 'look' | 'scan' | 'status' | 'export'
  folders: string[]
  model: string
  base?: number          // undefined: whatever the store already uses (100 for a new one)
  levels: number
  minutes: number        // 0: until stopped
  exportPath: string | null
  allowRemote: boolean
}

const VALUE_FLAGS = new Set(['model', 'base', 'levels', 'minutes'])
const BARE_FLAGS = new Set(['scan', 'status', 'export', 'allow-remote'])

export function parseLookArgs(argv: string[], resolve: (p: string) => string): LookArgs {
  const out: LookArgs = { mode: 'look', folders: [], model: 'qwen2.5vl:32b', levels: 4, minutes: 0, exportPath: null, allowRemote: false }
  const num = (name: string, v: string, ok: (n: number) => boolean) => {
    const n = Number(v)
    if (!Number.isFinite(n) || !ok(n)) throw new Error(`--${name} ${v}: not a valid value`)
    return n
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') continue // pnpm passes its separator through
    if (!a.startsWith('--')) { out.folders.push(resolve(a)); continue }
    const eq = a.indexOf('=')
    const name = a.slice(2, eq > 0 ? eq : undefined)
    if (VALUE_FLAGS.has(name)) {
      const v = eq > 0 ? a.slice(eq + 1) : argv[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`--${name} needs a value`)
      if (name === 'model') out.model = v
      if (name === 'base') out.base = num(name, v, (n) => n >= 5)
      if (name === 'levels') out.levels = num(name, v, (n) => Number.isInteger(n) && n >= 1 && n <= 8)
      if (name === 'minutes') out.minutes = num(name, v, (n) => n > 0)
    } else if (BARE_FLAGS.has(name) && eq < 0) {
      if (name === 'allow-remote') out.allowRemote = true
      else if (out.mode !== 'look') throw new Error(`--${name} and --${out.mode} can't be used together`)
      else out.mode = name as LookArgs['mode']
      if (name === 'export' && argv[i + 1] && !argv[i + 1].startsWith('--')) out.exportPath = resolve(argv[++i])
    } else {
      throw new Error(`unknown option ${a}`)
    }
  }
  if (out.folders.length && (out.mode === 'status' || out.mode === 'export')) throw new Error(`--${out.mode} doesn't take folders`)
  return out
}
