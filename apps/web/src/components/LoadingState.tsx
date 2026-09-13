// Shared loading indicator for client pages. A centered inline indicator —
// three blinking square blocks (sharp corners, single blue accent, in keeping
// with the monospace/retro design system) above a label — that replaces a
// page's content while its data fetch is in flight. Previously each client
// page rendered a bare centered "Loading…" text node; owning the look here
// keeps it consistent and a touch more elegant on a slow connection. See #121.
export default function LoadingState({
  label = 'Loading…',
  className = 'flex-1',
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 ${className}`}
    >
      <div className="flex gap-1.5" aria-hidden="true">
        <span className="w-2 h-2 bg-primary animate-pulse" />
        <span className="w-2 h-2 bg-primary animate-pulse [animation-delay:150ms]" />
        <span className="w-2 h-2 bg-primary animate-pulse [animation-delay:300ms]" />
      </div>
      <span className="text-sm text-muted tracking-widest">{label}</span>
    </div>
  )
}
