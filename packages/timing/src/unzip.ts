import { inflateRawSync } from 'zlib'

/** A single extracted file from a zip archive. */
export type ZipEntry = { filename: string; data: ArrayBuffer }

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50

/**
 * Minimal zip reader — enough to pull trace files out of a fitness-app export
 * (e.g. Garmin's `*_ACTIVITY.fit` wrapped in a zip). No dependency: reads the
 * central directory for reliable sizes (local headers use a data descriptor
 * with zeroed sizes) and inflates stored/deflated entries.
 *
 * Returns every file entry (directories skipped). Throws on anything it can't
 * read (encrypted, zip64, unsupported compression) — callers treat that as a
 * parse failure.
 *
 * Bounded (security audit 2026-09): a few MB of zip can inflate to gigabytes,
 * enough to take the 1 GB server Lambda down. An entry may not claim or
 * inflate to more than `maxEntryBytes`, nor may the archive hold more than
 * `maxEntries` files. A one-activity export is well under both.
 */
export function readZip(
  data: ArrayBuffer,
  { maxEntryBytes = 50 * 1024 * 1024, maxEntries = 64 }: { maxEntryBytes?: number; maxEntries?: number } = {},
): ZipEntry[] {
  const buf = Buffer.from(data)

  // Find the End Of Central Directory record (search backwards past the
  // variable-length comment).
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip file')

  const entryCount = buf.readUInt16LE(eocd + 10)
  if (entryCount > maxEntries) throw new Error(`zip has too many files (${entryCount})`)
  let offset = buf.readUInt32LE(eocd + 16)

  const entries: ZipEntry[] = []
  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIG) throw new Error('bad central directory')

    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const uncompressedSize = buf.readUInt32LE(offset + 24)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const filename = buf.slice(offset + 46, offset + 46 + nameLen).toString('utf8')

    // Advance to the next central-directory record.
    offset += 46 + nameLen + extraLen + commentLen

    // Directory entries end in '/' and carry no data.
    if (filename.endsWith('/')) continue

    // Locate the compressed bytes via the local header (its name/extra lengths
    // can differ from the central record's).
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const compressed = buf.slice(dataStart, dataStart + compressedSize)

    if (uncompressedSize > maxEntryBytes) throw new Error(`zip entry too large (${uncompressedSize} bytes)`)
    let content: Buffer
    if (method === 0) {
      content = compressed // stored, no compression
    } else if (method === 8) {
      // Capped as well: the declared size above could be a lie.
      content = inflateRawSync(compressed, { maxOutputLength: maxEntryBytes })
    } else {
      throw new Error(`unsupported compression method ${method}`)
    }
    if (content.length !== uncompressedSize) throw new Error('size mismatch after inflate')

    // Copy into a fresh ArrayBuffer (content may be a view onto a larger,
    // pooled Buffer, and .buffer is typed ArrayBufferLike).
    const out = new Uint8Array(content.byteLength)
    out.set(content)
    entries.push({ filename, data: out.buffer })
  }

  return entries
}
