import { NextRequest, NextResponse } from 'next/server'
import { getSharedSession } from '@/lib/analysis-store'

type Params = { params: Promise<{ shareId: string }> }

// GET — the public, read-only view of a shared paddle (#202). No auth: anyone
// with the unlisted token can see it. Only the fields the read-only view needs
// are exposed (result + narrative + boat), never the owner's userId or note.
export async function GET(_req: NextRequest, { params }: Params) {
  const { shareId } = await params
  const session = await getSharedSession(shareId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    session: {
      id: session.id,
      paddledAt: session.paddledAt,
      source: { type: session.source.type },
      result: session.result,
      boatClass: session.boatClass,
      seat: session.seat,
    },
  })
}
