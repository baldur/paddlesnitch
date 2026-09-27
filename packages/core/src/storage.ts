import path from 'path'
import fs from 'fs/promises'
import { createHmac, timingSafeEqual } from 'crypto'

// Both helpers read env vars at call time so tests can set DATA_DIR / USE_LOCAL_STORAGE in beforeEach
function localRoot() {
  return process.env.DATA_DIR ?? path.join(process.cwd(), '.local-data')
}
function isDev() {
  return process.env.NODE_ENV === 'development' || process.env.USE_LOCAL_STORAGE === 'true'
}

// In dev: filesystem under .local-data/
// In prod: S3 (same interface, different backing)

export async function getObject(key: string): Promise<Buffer | null> {
  if (isDev()) {
    const filePath = path.join(localRoot(), key)
    try {
      return await fs.readFile(filePath)
    } catch {
      return null
    }
  }
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3')
  const s3 = new S3Client({})
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: process.env.DATA_BUCKET!, Key: key }))
    const chunks: Uint8Array[] = []
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  } catch {
    return null
  }
}

export async function putObject(key: string, body: Buffer | string): Promise<void> {
  if (isDev()) {
    const filePath = path.join(localRoot(), key)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, body)
    return
  }
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
  const s3 = new S3Client({})
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.DATA_BUCKET!,
      Key: key,
      Body: body,
      ContentType: typeof body === 'string' ? 'application/json' : 'application/octet-stream',
    })
  )
}

export async function listKeys(prefix: string): Promise<string[]> {
  if (isDev()) {
    const dir = path.join(localRoot(), prefix)
    try {
      // withFileTypes so we can skip directory entries — `fs.readdir` with
      // recursive:true returns BOTH files and dirs by default, which differs
      // from the S3 path's behaviour (only objects). Keep both consistent.
      const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true })
      return entries
        .filter(e => e.isFile())
        .map(e => {
          const parent = path.relative(dir, e.parentPath ?? dir)
          return path.join(prefix, parent, e.name).replace(/\\/g, '/')
        })
    } catch {
      return []
    }
  }
  const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3')
  const s3 = new S3Client({})
  const res = await s3.send(
    new ListObjectsV2Command({ Bucket: process.env.DATA_BUCKET!, Prefix: prefix })
  )
  return (res.Contents ?? []).map(o => o.Key!).filter(Boolean)
}

export async function deleteObject(key: string): Promise<void> {
  if (isDev()) {
    const filePath = path.join(localRoot(), key)
    try {
      await fs.unlink(filePath)
    } catch {
      // ignore — already gone
    }
    return
  }
  const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3')
  const s3 = new S3Client({})
  await s3.send(new DeleteObjectCommand({ Bucket: process.env.DATA_BUCKET!, Key: key }))
}

export async function getJson<T>(key: string): Promise<T | null> {
  const buf = await getObject(key)
  if (!buf) return null
  return JSON.parse(buf.toString('utf8')) as T
}

export async function putJson(key: string, value: unknown): Promise<void> {
  await putObject(key, JSON.stringify(value, null, 2))
}

// ---------------------------------------------------------------------------
// Presigned download URLs
// ---------------------------------------------------------------------------
// A credential-free, expiring URL for one object. Used for firmware images: the
// device follows the URL with no Authorization header, so the URL itself has to
// carry the grant and has to stop working.
//
// This is the one place where dev and prod genuinely differ in KIND, not just in
// backing store, so it is worth being explicit rather than pretending otherwise:
//
//   prod — a real S3 SigV4 presigned GET. Nothing of ours serves the bytes.
//   dev  — there is no S3, so the app serves the file itself from
//          /api/devices/firmware/download, and the URL carries an HMAC over
//          (key, expiry). Same contract the device sees: no credentials, expires,
//          one object.
//
// The dev signing key is derived from the data directory and is NOT a secret —
// it never exists in production, where `isDev()` is false.

const DEV_SIGNING_CONTEXT = 'paddlesnitch-local-presign-v1'

function devSigningKey(): string {
  return `${DEV_SIGNING_CONTEXT}:${localRoot()}`
}

/** The HMAC a locally-presigned URL carries. Exported so the dev download route
 *  verifies with exactly the same function that produced it. */
export function devPresignSignature(key: string, expiresAtMs: number): string {
  return createHmac('sha256', devSigningKey()).update(`${key}\n${expiresAtMs}`).digest('hex')
}

/** Constant-time check of a locally-presigned URL's query. Dev only — production
 *  never reaches this path, because the URL points at S3. */
export function devPresignValid(key: string, exp: string | null, sig: string | null): boolean {
  if (!key || !exp || !sig) return false
  const expiresAtMs = Number(exp)
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false
  const want = Buffer.from(devPresignSignature(key, expiresAtMs), 'utf8')
  const got = Buffer.from(sig, 'utf8')
  return want.length === got.length && timingSafeEqual(want, got)
}

/**
 * A URL that downloads `key` with no credentials, valid for `expiresInSeconds`.
 *
 * `origin` is only consulted in dev (to build an absolute same-origin URL); in
 * production the URL points at S3 and the origin is irrelevant.
 */
export async function presignGetUrl(key: string, expiresInSeconds: number, origin?: string): Promise<string> {
  if (isDev()) {
    const exp = Date.now() + expiresInSeconds * 1000
    const q = new URLSearchParams({ key, exp: String(exp), sig: devPresignSignature(key, exp) })
    return `${origin ?? ''}/api/devices/firmware/download?${q}`
  }
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3')
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
  const s3 = new S3Client({})
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: process.env.DATA_BUCKET!, Key: key }),
    { expiresIn: expiresInSeconds },
  )
}
