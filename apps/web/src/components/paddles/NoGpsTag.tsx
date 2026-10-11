// In place of a route thumbnail, for a paddle without a map: the tracker's
// GPS failed, so the paddle has time, strokes and boat motion but no route (#414).
export default function NoGpsTag({ size = 64 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size }}
      className="shrink-0 rounded bg-bg border border-border flex items-center justify-center text-[9px] tracking-widest text-muted">
      NO GPS
    </span>
  )
}
