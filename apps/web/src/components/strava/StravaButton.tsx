// The official "Connect with Strava" button. Strava's brand guidelines require
// their exact button artwork for any auth/connect action and forbid altering it,
// so we render the supplied SVG as-is and only constrain its HEIGHT (width auto)
// to preserve the proportions. It's used for both first-time connect and Strava
// sign-in — "Connect with Strava" is Strava's single sanctioned CTA (they no
// longer ship a separate "Sign in" button). See public/strava/ (#107).
//
// `post`: a form that POSTs to `href` (connecting a signed-in account, which a
// plain link must not be able to start; see att/api/strava/connect). Sign-in
// stays a link.
export default function StravaButton({
  href,
  className,
  post = false,
}: {
  href: string
  className?: string
  post?: boolean
}) {
  if (post) {
    return (
      <form method="post" action={href} className={`inline-block ${className ?? ''}`}>
        <button type="submit" aria-label="Connect with Strava" className="block cursor-pointer rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {/* eslint-disable-next-line @next/next/no-img-element -- official brand asset, as below. */}
          <img src="/strava/connect-with-strava.svg" alt="" width={237} height={48} className="h-11 w-auto" />
        </button>
      </form>
    )
  }
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
