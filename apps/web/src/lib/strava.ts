import { authorizeUrl as coreAuthorizeUrl } from '@paddlesnitch/core/strava'
import { stravaOn } from '@/lib/sign-in-options'

export * from '@paddlesnitch/core/strava'

/**
 * Strava's consent page, or null when Strava isn't available: not set up, or
 * switched off (lib/sign-in-options.ts). Every way into Strava (sign-in,
 * connecting on the website and in the apps) already says "not available" on null.
 */
export async function authorizeUrl(...args: Parameters<typeof coreAuthorizeUrl>): Promise<string | null> {
  return stravaOn() ? coreAuthorizeUrl(...args) : null
}
