// The official "Connect with Strava" button. Strava's brand guidelines require
// their exact button artwork for any auth/connect action and forbid altering it,
// so we render the supplied SVG as-is and only constrain its HEIGHT (width auto)
// to preserve the proportions. It's used for both first-time connect and Strava
// sign-in — "Connect with Strava" is Strava's single sanctioned CTA (they no
// longer ship a separate "Sign in" button). See public/strava/ (#107).
export default function StravaButton({
  href,
  className,
}: {
  href: string
  className?: string
}) {
  return (
    <a href={href} aria-label="Connect with Strava" className={`inline-block ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- official brand
          asset served as-is from public/; next/image would optimise/restyle it,
          which Strava's guidelines forbid. */}
      <img
        src="/strava/connect-with-strava.svg"
        alt="Connect with Strava"
        width={237}
        height={48}
        className="h-11 w-auto"
      />
    </a>
  )
}
