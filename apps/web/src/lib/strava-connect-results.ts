// How connecting Strava can end, and the words for each: the account page's
// banner (`/account?strava=<key>`) and, through mobile/contract
// (constants.json `stravaConnectResults`), the apps' own messages. Client-safe.
export const STRAVA_CONNECT_RESULTS = {
  connected: { tone: 'ok', text: 'Strava connected.' },
  denied: { tone: 'err', text: 'You cancelled connecting Strava.' },
  state_mismatch: { tone: 'err', text: 'Couldn’t connect Strava. Please try again.' },
  exchange_failed: { tone: 'err', text: 'Couldn’t connect Strava. Please try again.' },
  not_configured: { tone: 'err', text: 'Couldn’t connect Strava right now. Please try again later.' },
  linked_elsewhere: { tone: 'err', text: 'Couldn’t connect Strava. It’s already connected to another paddlesnitch account. Sign in to that account and disconnect it there.' },
  use_app: { tone: 'err', text: 'Couldn’t connect Strava here. Connect it in the paddlesnitch app instead.' },
} as const satisfies Record<string, { tone: 'ok' | 'err'; text: string }>

export type StravaConnectResult = keyof typeof STRAVA_CONNECT_RESULTS
