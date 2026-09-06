import { ImageResponse } from 'next/og'
import QRCode from 'qrcode'
import { getSharedSession } from '@/lib/analysis-store'
import { shareCard } from '@/lib/share-card'

// The share-card OG image for a public paddle (docs/features/share-image-strava.md).
// Server-rendered via the opengraph-image route convention (the shared page is a
// client component, so its OG meta must come from here). Also the downloadable
// photo the owner adds to their Strava activity — hence the QR to the paddle,
// the only way a viewer inside Strava (no link unfurl) reaches the app.
export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'A paddlesnitch paddle'

const BG = '#0b1220', FG = '#e2e8f0', MUTED = '#94a3b8', PRIMARY = '#0369a1'

function routeDataUri(pts: [number, number][], w: number, h: number): string | null {
  if (pts.length < 2) return null
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${PRIMARY}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 22 }}>
      <div style={{ display: 'flex', fontSize: 52, color: FG }}>{value}</div>
      <div style={{ display: 'flex', fontSize: 20, color: MUTED, letterSpacing: 3 }}>{label}</div>
    </div>
  )
}

export default async function Image({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params
  const session = await getSharedSession(shareId).catch(() => null)
  const shareUrl = `https://paddlesnitch.com/analyse/shared/${shareId}`
  const card = session ? shareCard(session) : null
  const route = card ? routeDataUri(card.pts, card.viewW, card.viewH) : null
  // QR always points at the paddle; on the fallback card, at the site.
  const qr = await QRCode.toDataURL(session ? shareUrl : 'https://paddlesnitch.com', {
    margin: 1, width: 220, color: { dark: '#0b1220', light: '#ffffff' },
  }).catch(() => '')

  const wordmark = (
    <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, color: FG, letterSpacing: 2 }}>paddlesnitch</div>
  )

  const body = card ? (
    <div style={{ display: 'flex', width: '100%', height: '100%', flexDirection: 'column', background: BG, color: FG, padding: 56 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {wordmark}
        <div style={{ display: 'flex', fontSize: 24, color: MUTED }}>{[card.tag, card.date].filter(Boolean).join('   ·   ')}</div>
      </div>
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', marginTop: 20 }}>
        {route
          ? <img src={route} width={card.viewW} height={card.viewH} style={{ objectFit: 'contain' }} />
          : <div style={{ display: 'flex', width: card.viewW, height: card.viewH }} />}
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 56, flex: 1 }}>
          <Stat value={card.distance} label="DISTANCE" />
          <Stat value={card.duration} label="TIME" />
          <div style={{ display: 'flex' }}>
            <div style={{ display: 'flex', flexDirection: 'column', marginRight: 48 }}>
              <div style={{ display: 'flex', fontSize: 34, color: FG }}>{card.pace}</div>
              <div style={{ display: 'flex', fontSize: 20, color: MUTED, letterSpacing: 3 }}>PACE</div>
            </div>
            {card.spm && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', fontSize: 34, color: FG }}>{card.spm}</div>
                <div style={{ display: 'flex', fontSize: 20, color: MUTED, letterSpacing: 3 }}>RATE</div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', fontSize: 24, color: MUTED }}>Scan to see this paddle →</div>
        {qr ? <img src={qr} width={132} height={132} /> : <div style={{ display: 'flex' }} />}
      </div>
    </div>
  ) : (
    // Fallback: no session / revoked link — generic branded card, no leak.
    <div style={{ display: 'flex', width: '100%', height: '100%', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: BG, color: FG, padding: 56 }}>
      {wordmark}
      <div style={{ display: 'flex', fontSize: 30, color: MUTED, marginTop: 16 }}>See what actually happened on your paddle.</div>
      {qr ? <img src={qr} width={140} height={140} style={{ marginTop: 32 }} /> : <div style={{ display: 'flex' }} />}
    </div>
  )

  return new ImageResponse(body, { ...size })
}
