// Which outside sign-ins are switched on, per build (repository variables in
// deploy.yml). Read by the sign-in page, the account page and the apps
// (GET /att/api/auth/options), so all of them show the same buttons.

/** Sign in with Google: on when the build has NEXT_PUBLIC_GOOGLE_SIGNIN=1 (variable GOOGLE_SIGNIN). */
export const googleSignInOn = () => process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === '1'

/**
 * Strava (sign-in, connecting, importing): on unless the build has
 * NEXT_PUBLIC_STRAVA_OFF=1 (variable STRAVA_OFF). Switched off in production
 * while our Strava API app needs a paid subscription (2026-10-26).
 */
export const stravaOn = () => process.env.NEXT_PUBLIC_STRAVA_OFF !== '1'
