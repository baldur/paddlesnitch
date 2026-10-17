import type { ReactNode } from 'react'

// Containers and small status marks (docs/features/design-system.md).

export const cardClass = 'rounded-control border border-border bg-surface'
// A whole card that opens something: hover lift + a chevron says "tap me".
export const cardLinkClass = `${cardClass} block transition-colors hover:border-border-strong hover:bg-surface-2`

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`${cardClass} p-4 ${className}`}>{children}</div>
}

export function Chevron({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={`w-5 h-5 shrink-0 text-muted ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// A big number with its label, e.g. 4:44.8 / TIME. The number is mono.
export function Stat({ label, value, sub, tone = 'fg' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'fg' | 'primary' | 'split' }) {
  const color = tone === 'primary' ? 'text-primary-text' : tone === 'split' ? 'text-split' : 'text-fg'
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="font-mono text-xs uppercase tracking-wider text-muted">{label}</span>
      <span className={`tabular text-xl sm:text-2xl font-semibold ${color}`}>{value}</span>
      {sub && <span className="text-sm text-muted">{sub}</span>}
    </div>
  )
}

export type BadgeTone = 'neutral' | 'primary' | 'green' | 'red' | 'split'
const tones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted',
  primary: 'bg-primary/20 text-primary-text',
  green: 'bg-green/15 text-green',
  red: 'bg-red/15 text-red',
  split: 'bg-split/15 text-split',
}
export function badgeClass(tone: BadgeTone = 'neutral') {
  return `inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`
}
// Use sparingly: a badge that's on most rows stops meaning anything.
export function Badge({ tone, children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={badgeClass(tone)}>{children}</span>
}

// What a list shows before it has anything in it: say what will be here and
// offer the one action that fills it. Invite, don't explain.
export function EmptyState({ title, body, action, icon }: { title: ReactNode; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className={`${cardClass} border-dashed px-6 py-10 flex flex-col items-center text-center gap-3`}>
      {icon && <div className="text-muted">{icon}</div>}
      <h2 className="text-lg font-semibold text-fg text-balance">{title}</h2>
      {body && <p className="text-base text-muted max-w-md">{body}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}
