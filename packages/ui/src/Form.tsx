import type { ReactNode } from 'react'

// Form controls (docs/features/design-system.md). Inputs are 16 px text so
// iPhones don't zoom in on focus, and 44 px tall. Every input has a visible
// label above it; help text sits below in muted sentence case.

export const inputClass =
  'w-full min-h-11 rounded-control border border-border-strong bg-surface px-3 text-base text-fg ' +
  'placeholder:text-muted/70 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary ' +
  'disabled:opacity-50'

export const selectClass = `${inputClass} pr-8`

export function Field({
  label,
  help,
  error,
  htmlFor,
  children,
  className = '',
}: {
  label: ReactNode
  help?: ReactNode
  error?: ReactNode
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-fg">{label}</label>
      {children}
      {help && !error && <p className="text-sm text-muted">{help}</p>}
      {error && <p className="text-sm text-red" role="alert">{error}</p>}
    </div>
  )
}

// A segmented choice (2–4 options), e.g. the source of a new paddle. Wraps
// rather than squashing labels on a phone.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 rounded-control bg-surface p-1 border border-border">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`flex-1 min-h-10 px-3 rounded-[4px] text-sm font-medium transition-colors whitespace-nowrap ${
            o.value === value ? 'bg-surface-2 text-fg shadow-sm' : 'text-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
