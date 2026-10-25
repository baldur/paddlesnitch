import { NextResponse } from 'next/server'
import { getObject, devPresignValid } from '@paddlesnitch/core/storage'

// GET /api/devices/firmware/download?key=…&exp=…&sig=… — LOCAL DEVELOPMENT ONLY.
//
// In production a firmware download URL points at S3 and nothing of ours serves
// the bytes. There is no S3 in local dev, so `presignGetUrl` points here instead
// and the app serves the file itself.
//
// The contract the device sees is deliberately identical either way: a URL with
// no credentials on it, valid for one object, that stops working. Here that is
// an HMAC over (key, expiry) rather than SigV4 — same shape, dev-only key.
//
// The guard below is the important line. If this ever ran in production it
// would be an unauthenticated read of arbitrary keys in the data bucket, so it
// refuses outright rather than relying on the signature alone.

function isDev() {
  return process.env.NODE_ENV === 'development' || process.env.USE_LOCAL_STORAGE === 'true'
}

export async function GET(req: Request) {
  if (!isDev()) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const url = new URL(req.url)
  const key = url.searchParams.get('key') ?? ''
  // Only firmware images and prepared "Download my data" files (whose random
  // name is in the signed key). Even signed, this must not become a way to read
  // sessions or claims out of the data directory.
  const isExport = /^exports\/[\w-]{1,64}\/[\w-]{21}\.json$/.test(key)
  if (!isExport && !/^firmware\/[\w.-]{1,40}\/firmware\.bin$/.test(key)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!devPresignValid(key, url.searchParams.get('exp'), url.searchParams.get('sig'))) {
    return NextResponse.json({ error: 'expired_or_invalid' }, { status: 403 })
  }

  const body = await getObject(key)
  if (!body) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const name = url.searchParams.get('name') ?? ''
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'content-type': isExport ? 'application/json; charset=utf-8' : 'application/octet-stream',
      'content-length': String(body.length),
      ...(isExport && /^[\w.-]{1,120}\.json$/.test(name) ? { 'content-disposition': `attachment; filename="${name}"` } : {}),
    },
  })
}
