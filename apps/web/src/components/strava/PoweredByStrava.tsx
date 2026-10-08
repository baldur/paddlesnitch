// "Powered by Strava" attribution. Strava's brand guidelines require this logo
// on any view built from Strava data (the activity picker, the upload Strava
// tab, and leaderboard rows imported from Strava). Rendered as the supplied
// image, height-constrained (width auto) so its proportions aren't altered.
// See public/strava/ (#107).
export default function PoweredByStrava({ className }: { className?: string }) {
  return (
    // Official brand asset, served as-is from public/: must not be optimised
    // or restyled (Strava's guidelines).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/strava/powered-by-strava.svg"
      alt="Powered by Strava"
      width={365}
      height={37}
      className={`h-5 w-auto ${className ?? ''}`}
    />
  )
}
