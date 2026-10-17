import type { ReactNode } from 'react'

// Page templates (docs/features/design-system.md). Every page body sits in a
// <Page> so widths and gutters match across the site, and starts with a
// <PageHeader> so there's always a visible title (Krug's trunk test: "what
// page is this?").

const widths = {
  narrow: 'max-w-xl',   // forms, sign in, single-purpose pages
  default: 'max-w-3xl', // lists, reading
  wide: 'max-w-5xl',    // dashboards, maps with side panels
} as const

export function Page({ width = 'default', className = '', children }: { width?: keyof typeof widths; className?: string; children: ReactNode }) {
  return (
    <div className={`flex-1 w-full ${widths[width]} mx-auto px-4 py-6 sm:py-10 flex flex-col gap-8 ${className}`}>
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: ReactNode
  eyebrow?: ReactNode     // small mono label above the title (a parent, a date)
  description?: ReactNode
  actions?: ReactNode     // the screen's main action(s), primary first
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1.5 min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="text-2xl sm:text-3xl font-semibold text-fg text-balance">{title}</h1>
        {description && <p className="text-base text-muted max-w-prose">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
    </header>
  )
}

// A titled block within a page.
export function Section({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col gap-3 ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h2 className="text-lg font-semibold text-fg">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

// The only place uppercase survives: short mono labels over data (DISTANCE,
// PACE /500, a column head). Never for sentences or buttons.
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`font-mono text-xs uppercase tracking-wider text-muted ${className}`}>{children}</p>
}
export const eyebrowClass = 'font-mono text-xs uppercase tracking-wider text-muted'
