'use client'
import { useEffect, useId, useState } from 'react'
import type { Found } from '@paddlesnitch/waterways/find'
import type { LatLng } from '@paddlesnitch/waterways/types'
import { Field, inputClass } from '@paddlesnitch/ui/Form'
import { trpc } from '@/lib/trpc'

// Set a plan's start or finish by name (#506): type a lock, wharf or town and
// pick one; it sets the end exactly as a click on that spot would. Keyboard
// all the way: arrows move through the matches, Enter picks, Escape closes.

const KIND: Record<Found['kind'], string> = {
  city: 'city', town: 'town', village: 'village', hamlet: 'hamlet', lock: 'lock', weir: 'weir',
  wharf: 'wharf', slipway: 'slipway', portage: 'portage',
}

export default function EndSearch({ label, at, waterway, near, onPick }: {
  label: 'Start' | 'Finish'
  at: LatLng | null          // the end as set now (by a pick or a click)
  waterway?: string | null   // its waterway, once known ('' for unnamed water)
  near?: LatLng              // prefer matches near here
  onPick: (hit: Found) => void
}) {
  const id = useId()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [picked, setPicked] = useState<Found | null>(null)
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t) }, [q])
  const found = trpc.plan.find.useQuery({ q: debounced, near }, { enabled: open && debounced.length >= 2, staleTime: Infinity })
  const hits = open && debounced.length >= 2 ? found.data ?? [] : []

  // The box shows the picked name while that's still the end; a click elsewhere clears it.
  const still = picked && at && picked.at[0] === at[0] && picked.at[1] === at[1]
  const value = open || !picked ? q : still ? picked.name : ''
  const pick = (h: Found) => { setPicked(h); setQ(h.name); setOpen(false); onPick(h) }
  const help = !at ? 'Type a lock, wharf or town.'
    : waterway == null ? 'Finding the water…'
    : `On ${waterway || 'unnamed water'}.`

  return (
    <Field label={label} htmlFor={`${id}-in`} help={help}>
      <div className="relative">
      <input id={`${id}-in`} className={inputClass} value={value} placeholder="Lock, wharf or town" autoComplete="off"
        role="combobox" aria-expanded={hits.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={hits.length ? `${id}-${Math.min(active, hits.length - 1)}` : undefined}
        onFocus={() => { setQ(value); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={e => { setQ(e.target.value); setOpen(true); setActive(0) }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); setActive(a => (a + 1) % hits.length) }
          else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); setActive(a => (a - 1 + hits.length) % hits.length) }
          else if (e.key === 'Enter' && hits.length) { e.preventDefault(); pick(hits[Math.min(active, hits.length - 1)]) }
          else if (e.key === 'Escape') setOpen(false)
        }} />
      {hits.length > 0 && (
        <ul id={`${id}-list`} role="listbox" aria-label={`${label} matches`}
          className="absolute z-[600] left-0 right-0 top-full mt-1 rounded-control bg-surface border border-border-strong shadow-lg max-h-72 overflow-y-auto">
          {hits.map((h, i) => (
            <li key={`${h.name}@${h.at}`} id={`${id}-${i}`} role="option" aria-selected={i === active}
              className={`px-3 py-2 min-h-11 cursor-pointer text-base ${i === active ? 'bg-surface-2' : ''} hover:bg-surface-2`}
              onMouseDown={e => e.preventDefault()} onClick={() => pick(h)}>
              {h.name} <span className="text-muted text-sm">· {KIND[h.kind]}{h.waterway ? `, ${h.waterway}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      </div>
    </Field>
  )
}
