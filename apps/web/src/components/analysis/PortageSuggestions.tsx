'use client'
// Carries on this paddle (packages/waterways/src/portage-detect.ts): where your
// track stops beside a lock, we draw where it looks like you got out and back
// in, and you publish it to OpenPortage (CC0) or don't. Never published for you.
import { useState } from 'react'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { cumulative } from '@paddlesnitch/waterways/line'
import { haversine } from '@paddlesnitch/timing/geo'
import type { PortageSuggestion } from '@paddlesnitch/waterways/portage-detect'
import type { LatLng } from '@paddlesnitch/waterways/types'
import PortageDrawing from '@/components/plan/PortageDrawing'
import { portageMap } from '@/lib/plan-ui'
import { trpc } from '@/lib/trpc'

export default function PortageSuggestions({ sessionId, points }: { sessionId: string; points: { lat: number; lng: number }[] }) {
  const utils = trpc.useUtils()
  const found = trpc.portage.fromPaddle.useQuery({ sessionId }, { retry: false, staleTime: Infinity })
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [published, setPublished] = useState<Set<string>>(new Set())
  const list = (found.data ?? []).filter(s => !skipped.has(s.featureId))
  if (!list.length && !published.size) return null
  const line: LatLng[] = points.map(p => [p.lat, p.lng])
  return (
    <section aria-label="Carries on this paddle" className="flex flex-col gap-3" data-testid="portage-suggestions">
      <h2 className="text-lg font-semibold text-fg">Carries on this paddle</h2>
      <p className="text-sm text-muted">
        Your track slows beside {list.length === 1 ? 'this lock' : 'these locks'}. If you carried round, publish where you got out and back in, and everyone
        planning past will know which bank to land on. If you went through in the boat, or it&apos;s wrong, skip it.
      </p>
      {published.size > 0 && <p className="text-sm text-fg" role="status">Published, thank you. It&apos;s on the planner now.</p>}
      <ul className="flex flex-col gap-4">
        {list.map(s => <Suggestion key={s.featureId} s={s} line={line}
          onSkip={() => setSkipped(x => new Set(x).add(s.featureId))}
          onPublished={() => { setPublished(x => new Set(x).add(s.featureId)); setSkipped(x => new Set(x).add(s.featureId)); utils.portage.fromPaddle.invalidate() }} />)}
      </ul>
    </section>
  )
}

function Suggestion({ s, line, onSkip, onPublished }: { s: PortageSuggestion; line: LatLng[]; onSkip: () => void; onPublished: () => void }) {
  const [cc0, setCc0] = useState(false)
  const add = trpc.portage.add.useMutation({ onSuccess: onPublished })
  // Where along the track the lock is, for the drawing's direction arrow.
  const cum = cumulative(line)
  let near = 0
  line.forEach((p, i) => { if (haversine(p, s.at) < haversine(line[near], s.at)) near = i })
  const map = portageMap(line, { chainageM: cum[near], leg: 'out', feature: { id: s.featureId, kind: 'lock', name: s.name, at: s.at, source: { source: 'contribution', fetchedAt: '' } } },
    { id: s.featureId, by: '', carryM: s.carryM, takeOut: { at: s.landings[0], bank: 'left' }, putIn: { at: s.landings[1], bank: 'left' } })
  return (
    <li className="flex gap-4 items-start border-t border-border pt-4">
      <PortageDrawing map={map} id={`suggest-${s.featureId}`} name={s.name} className="shrink-0 w-32 h-32" />
      <div className="flex flex-col gap-2 min-w-0">
        <p className="text-fg"><span className="font-medium">{s.name ?? 'Lock'}</span>
          <span className="text-muted"> · out at T, back in at P, about {s.carryM} m and {s.minutes} min</span></p>
        <label className="flex gap-2 items-start text-sm text-muted">
          <input type="checkbox" className="mt-0.5" checked={cc0} onChange={e => setCc0(e.target.checked)} aria-label="Release under CC0" />
          <span>I release this under <a className="underline" href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noreferrer">CC0</a> (anyone may reuse it) and it&apos;s my own observation. It&apos;s public at once, with my display name.</span>
        </label>
        <div className="flex gap-2">
          <button type="button" className={buttonClass('primary', 'sm')} disabled={!cc0 || add.isPending}
            onClick={() => add.mutate({ featureId: s.featureId, at: s.at, landings: s.landings, cc0: true })}>
            {add.isPending ? 'Publishing…' : 'Publish'}
          </button>
          <button type="button" className={buttonClass('quiet', 'sm')} onClick={onSkip}>Skip</button>
        </div>
        {add.isError && <p className="text-sm text-red" role="alert">Couldn&apos;t publish. Please try again.</p>}
      </div>
    </li>
  )
}
