import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'

// The one button style for the platform (docs/features/design-system.md).
//
//   primary   — the one main action on a screen (Add paddle, Submit, Save)
//   secondary — other actions people use (Compare, Share, Cancel)
//   quiet     — low-weight actions that shouldn't compete (Hide, Edit)
//   danger    — destroys something (Delete account). Quiet in the layout, red.
//
// Sentence case labels ("Add paddle", not "ADD PADDLE"). Every size is a 44 px
// tap target or larger except `sm`, which is for dense rows on desktop only.
// For a Next <Link>, use the class: <Link className={buttonClass('primary')}>.

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'
export type ButtonSize = 'md' | 'sm'

const base =
  'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ' +
  'disabled:opacity-50 disabled:cursor-not-allowed select-none whitespace-nowrap'

const sizes: Record<ButtonSize, string> = {
  md: 'min-h-11 px-4 text-sm',
  sm: 'min-h-11 sm:min-h-8 px-3 text-sm',
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-[color-mix(in_srgb,var(--color-primary)_85%,white)]',
  secondary: 'border border-border-strong bg-surface text-fg hover:bg-surface-2',
  quiet: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'border border-red/50 text-red hover:bg-red/10',
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra = '') {
  return `${base} ${sizes[size]} ${variants[variant]}${extra ? ` ${extra}` : ''}`
}

type Common = { variant?: ButtonVariant; size?: ButtonSize }

export function Button({ variant, size, className = '', type = 'button', ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />
}

// A plain <a> styled as a button, for links that leave the current section.
export function ButtonLink({ variant, size, className = '', ...rest }: Common & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={buttonClass(variant, size, className)} {...rest} />
}
