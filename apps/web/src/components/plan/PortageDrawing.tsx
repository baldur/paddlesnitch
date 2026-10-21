// A north-up drawing of one portage or lock from our own data: the water near
// it, an arrow the way you're going, the lock, take-out T and put-in P joined
// by the carry (when known), north and a scale. Geometry: portageMap. In the
// Netherlands it can sit on the Kadaster's aerial photo (printable, CC BY 4.0).
import type { PortageMap } from '@/lib/plan-ui'

export default function PortageDrawing({ map: d, id, name, photo, className = '' }: { map: PortageMap; id: string; name?: string; photo?: string; className?: string }) {
  const clip = `clip-${id.replace(/[^\w-]/g, '_')}`
  const ink = photo ? 'white' : 'black'
  return (
    <svg viewBox={`0 0 ${d.size} ${d.size}`} className={`border border-black bg-white ${className}`}
      role="img" aria-label={d.takeOut ? `Map of ${name ?? 'the portage'}: take out at T, put in at P` : `Aerial photo of ${name ?? 'the lock'}`} data-testid="portage-drawing">
      <clipPath id={clip}><rect width={d.size} height={d.size} /></clipPath>
      <g clipPath={`url(#${clip})`}>
        {photo
          ? <image href={photo} x={0} y={0} width={d.size} height={d.size} preserveAspectRatio="none" data-testid="aerial-photo" />
          : <path d={d.route} fill="none" stroke="#9ca3af" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />}
        {d.takeOut && d.putIn && <line x1={d.takeOut[0]} y1={d.takeOut[1]} x2={d.putIn[0]} y2={d.putIn[1]} stroke={ink} strokeWidth={2} strokeDasharray="5 4" />}
        <rect x={d.lock[0] - 5} y={d.lock[1] - 5} width={10} height={10} fill="none" stroke={photo ? '#facc15' : 'black'} strokeWidth={2} />
        <g transform={`translate(${d.arrow.x} ${d.arrow.y}) rotate(${d.arrow.deg})`}><path d="M0 -9 L6 6 L0 2 L-6 6 Z" fill={photo ? '#facc15' : 'black'} stroke="black" strokeWidth={photo ? 1 : 0} /></g>
        {d.takeOut && d.putIn && ([['T', d.takeOut], ['P', d.putIn]] as const).map(([t, [x, y]]) => (
          <g key={t}><circle cx={x} cy={y} r={9} fill="black" stroke="white" strokeWidth={photo ? 1.5 : 0} /><text x={x} y={y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="white">{t}</text></g>
        ))}
      </g>
      {/* On a photo, white with a dark halo (the stroke painted under the fill) reads on any ground. */}
      <g fill={ink} stroke={photo ? 'black' : 'none'} strokeWidth={photo ? 2.5 : 0} paintOrder="stroke" strokeLinejoin="round">
        <text x={d.size - 12} y={18} textAnchor="middle" fontSize={12} fontWeight={700}>N</text>
        <path d={`M${d.size - 12} 22 l4 10 h-8 Z`} />
        <rect x={8} y={d.size - 11.5} width={d.scale.px} height={3} />
        <text x={8} y={d.size - 15} fontSize={11}>{d.scale.m} m</text>
      </g>
    </svg>
  )
}
