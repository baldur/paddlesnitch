// "View on Strava" — links an imported entry back to its source activity on
// Strava, as the brand guidelines require for any displayed Strava data (#107).
export default function ViewOnStrava({
  activityId,
  className,
}: {
  activityId: number | string
  className?: string
}) {
  return (
    <a
      href={`https://www.strava.com/activities/${activityId}`}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? 'tt-link'}
    >
      View on Strava
    </a>
  )
}
