import Link from 'next/link'
import type { Metadata } from 'next'
import GuidePage, { Note, Steps } from '@/components/guide/GuidePage'

export const metadata: Metadata = { title: 'Create your account' }

export default function AccountStep() {
  return (
    <GuidePage slug="account" title="Create your account">
      <p>
        Your paddles go to your paddlesnitch account, so make one before you switch the tracker on.
        If you already have one, sign in and go to the next step.
      </p>

      <Steps>
        <li>Go to <Link href="/signin?next=/guide/switch-on">paddlesnitch.com and choose SIGN IN</Link>.</li>
        <li>Choose the <strong>SIGN UP</strong> tab.</li>
        <li>Enter your email, the name other paddlers will see, and a password. The password needs at
          least 8 characters, with an uppercase letter, a lowercase letter and a number.</li>
        <li>Tick the box to agree to the terms, then choose <strong>CREATE ACCOUNT</strong>.</li>
      </Steps>

      <p>
        Rather not have a password? You can sign in with Strava instead.
      </p>

      <Note>
        Use the email you applied to the beta with, so we know which account is yours.
      </Note>
    </GuidePage>
  )
}
