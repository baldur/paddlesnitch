// Derived values, computed once and never stale (docs/features/performance.md).
//
// A derived value is stored under a key made from the versions of everything it
// was computed from, plus the version of the code that computed it. A changed
// input gives a new key, so the next read recomputes: there is nothing to
// invalidate, and a stale value can't be served. Old copies are never read
// again; a lifecycle rule deletes `derived/` objects after 30 days.
//
// Layers, same keys: a small in-memory map in the warm server, then the object
// store (S3 in production, files locally). Pages call `derived()` only, so the
// store underneath can change (DynamoDB, Valkey) without touching them.
//
// Privacy: a private value lives under its owner's prefix (derived/u/{owner}/),
// is only computed after the caller's own permission check, and is deleted by
// account erasure (eraseDerived). Never put anything that depends on who is
// LOOKING into a derived value: cache the owner's data, filter per viewer after.
import { createHash } from 'crypto'
import { getObject, putObject, listKeys, deleteObject } from './storage'

export type VersionToken = string | number | boolean | null | undefined

export type DerivedSpec = {
  /** What is computed, e.g. 'recording-report'. Part of the key. */
  name: string
  /** Whose data it is ('public' for data anyone may see). */
  owner: string
  /** The version of every input: change any of them and the key changes. */
  inputs: VersionToken[]
  /**
   * The version of the code that computes it. Defaults to the deploy's commit
   * (CODE_VERSION, set by the CDK stack), so a deploy recomputes everything
   * once: always correct, slightly wasteful. Pass an explicit value only for a
   * stable, expensive computation, and bump it whenever its code changes.
   */
  code?: string
}

const L1_MAX = 100
const memory = new Map<string, unknown>()

function remember(key: string, value: unknown) {
  if (memory.has(key)) memory.delete(key)
  memory.set(key, value)
  if (memory.size > L1_MAX) memory.delete(memory.keys().next().value as string)
}

const ownerPrefix = (owner: string) => (owner === 'public' ? 'derived/public/' : `derived/u/${owner}/`)

/** The storage key for a spec. Exported for tests. */
export function derivedKey(spec: DerivedSpec): string {
  if (!/^[\w.-]{1,64}$/.test(spec.name)) throw new Error(`bad derived name: ${spec.name}`)
  if (!/^[\w.:-]{1,128}$/.test(spec.owner)) throw new Error('bad derived owner')
  const code = spec.code ?? process.env.CODE_VERSION ?? 'dev'
  const hash = createHash('sha256').update(JSON.stringify([code, ...spec.inputs])).digest('hex').slice(0, 40)
  return `${ownerPrefix(spec.owner)}${spec.name}/${hash}.json`
}

/**
 * The value for `spec`: from memory, else from the store, else computed now
 * (and stored for next time). A failed store write doesn't fail the read.
 */
export async function derived<T>(spec: DerivedSpec, compute: () => Promise<T> | T): Promise<T> {
  const key = derivedKey(spec)
  if (memory.has(key)) return memory.get(key) as T
  const stored = await getObject(key).catch(() => null)
  if (stored) {
    try {
      const value = JSON.parse(stored.toString('utf8')) as T
      remember(key, value)
      return value
    } catch { /* unreadable: recompute below */ }
  }
  const value = await compute()
  remember(key, value)
  await putObject(key, JSON.stringify(value)).catch(err => console.error('[derived] store failed', key, err))
  return value
}

/** Account erasure: every derived value owned by this user. */
export async function eraseDerived(owner: string): Promise<void> {
  if (owner === 'public') return
  for (const k of await listKeys(ownerPrefix(owner))) await deleteObject(k)
  for (const k of [...memory.keys()]) if (k.startsWith(ownerPrefix(owner))) memory.delete(k)
}

/** Tests only: forget the in-memory layer. */
export function _clearDerivedMemory() { memory.clear() }
