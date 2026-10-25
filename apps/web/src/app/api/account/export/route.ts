import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { getRequestUser } from '@/lib/auth'
import { putObject, presignGetUrl } from '@/lib/storage'
import { buildAccountExport, exportFilename } from '@/lib/account-export'

// GDPR Art. 15 (right of access) + Art. 20 (right to data portability).
//
// GET: the file itself, as an attachment. A Lambda can return at most 6 MB,
// and each paddle is ~0.1 MB (its map points), so past ~40 paddles this
// answer can't be sent at all: the download failed for well-used accounts.
//
// POST: what the account page uses. The file is written to the data bucket
// (exports/{userId}/, private, deleted after a day by a lifecycle rule and by
// account erasure) and the answer is a link valid for five minutes, from which
// S3 serves the download, of any size. Local dev has no S3, so there the link
// is a signed one to /api/devices/firmware/download (dev only), same shape.
export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return new NextResponse(JSON.stringify(await buildAccountExport(user), null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFilename(user)}"`,
    },
  })
}

export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const key = `exports/${user.id}/${nanoid()}.json`
  await putObject(key, JSON.stringify(await buildAccountExport(user), null, 2))
  // The link carries its own permission (the apps fetch it with no token).
  // Locally it points at our dev download route instead of S3, same shape.
  return NextResponse.json({ url: await presignGetUrl(key, 300, new URL(req.url).origin, { downloadAs: exportFilename(user) }) })
}
