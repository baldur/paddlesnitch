// A north-up drawing of one portage from our own data (no map tiles): the
// water near it, an arrow the way you're going, the lock, take-out T and
// put-in P joined by the carry, north and a scale. Geometry: portageMap.
import type { PortageMap } from '@/lib/plan-ui'

export default function PortageDrawing({ map: d, id, name, className = '' }: { map: PortageMap; id: string; name?: string; className?: string }) {
  const clip = `clip-${id.replace(/[^\w-]/g, '_')}`
  return (
    <svg viewBox={`0 0 ${d.size} ${d.size}`} className={`border border-black bg-white ${className}`}
      role="img" aria-label={`Map of ${name ?? 'the portage'}: take out at T, put in at P`} data-testid="portage-drawing">
      <clipPath id={clip}><rect width={d.size} height={d.size} /></clipPath>
      <g clipPath={`url(#${clip})`}>
        <path d={d.route} fill="none" stroke="#9ca3af" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
        <line x1={d.takeOut[0]} y1={d.takeOut[1]} x2={d.putIn[0]} y2={d.putIn[1]} stroke="black" strokeWidth={2} strokeDasharray="5 4" />
        <rect x={d.lock[0] - 5} y={d.lock[1] - 5} width={10} height={10} fill="white" stroke="black" strokeWidth={2} />
        <g transform={`translate(${d.arrow.x} ${d.arrow.y}) rotate(${d.arrow.deg})`}><path d="M0 -9 L6 6 L0 2 L-6 6 Z" fill="black" /></g>
        {([['T', d.takeOut], ['P', d.putIn]] as const).map(([t, [x, y]]) => (
          <g key={t}><circle cx={x} cy={y} r={9} fill="black" /><text x={x} y={y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="white">{t}</text></g>
        ))}
      </g>
      <text x={d.size - 12} y={18} textAnchor="middle" fontSize={12} fontWeight={700}>N</text>
      <path d={`M${d.size - 12} 22 l4 10 h-8 Z`} fill="black" />
      <line x1={8} y1={d.size - 10} x2={8 + d.scale.px} y2={d.size - 10} stroke="black" strokeWidth={3} />
      <text x={8} y={d.size - 15} fontSize={11}>{d.scale.m} m</text>
    </svg>
  )
}
