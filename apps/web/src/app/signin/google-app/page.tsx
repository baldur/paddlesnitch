import { Page, PageHeader } from '@paddlesnitch/ui/Layout'
import GoogleButton from '@/components/GoogleButton'
import { APP_GOOGLE_URL, isChallenge } from '@/lib/app-signin'
import { buttonClass } from '@paddlesnitch/ui/Button'

// The paddlesnitch app's Sign in with Google starts here, in the app's in-app
// browser (att/api/auth/google/init?challenge=). The tap is the point: a link
// alone must not be able to finish a Google sign-in for an app (see init).
export default async function GoogleAppSignIn({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams
  const challenge = typeof q.challenge === 'string' ? q.challenge : ''
  const n = typeof q.n === 'string' ? q.n : ''
  const ok = isChallenge(challenge) && n.length > 0
  return (
    <Page width="narrow" className="max-w-md">
      <PageHeader title="Sign in with Google" />
      {ok ? (
        <div className="flex flex-col gap-4">
          <p className="text-base text-muted">This signs you in to the paddlesnitch app with your Google account. Only continue if you started this in the app.</p>
          <div><GoogleButton href="/att/api/auth/google/init" post={{ challenge, n }} /></div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-base text-red">Couldn’t start signing in with Google. Go back to the app and try again.</p>
          <div><a href={`${APP_GOOGLE_URL}?error=google_failed`} className={buttonClass('primary')}>Back to the app</a></div>
        </div>
      )}
    </Page>
  )
}
