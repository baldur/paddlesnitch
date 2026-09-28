import Link from 'next/link'
import type { Metadata } from 'next'
import GuidePage, { Note, Screens, Steps } from '@/components/guide/GuidePage'
import TrackerScreen from '@/components/guide/TrackerScreen'

export const metadata: Metadata = { title: 'Add it to your account' }

export default function LinkStep() {
  return (
    <GuidePage slug="link" title="Add it to your account">
      <p>Once it’s on your WiFi, the tracker fills its screen with a code:</p>
      <Screens>
        <TrackerScreen name="linkQr" caption="Scan this with your phone’s camera" />
        <TrackerScreen name="linkCode" caption="Tap BOOT to see it as letters instead" />
      </Screens>

      <Steps>
        <li>
          Scan the code with your phone’s camera and open the link. It goes to{' '}
          <strong>paddlesnitch.com/devices</strong> with the code already filled in.
        </li>
        <li>Sign in if you’re asked to. You come back to the same page afterwards.</li>
        <li>Choose <strong>ADD</strong>. You can give the tracker a name first if you like.</li>
      </Steps>

      <p>
        No camera? Tap the BOOT button to see the 6 characters, then go to{' '}
        <Link href="/devices#add">paddlesnitch.com/devices</Link> and type them under{' '}
        <strong>ADD A TRACKER</strong>.
      </p>

      <Note>
        <strong>The code changes about every 5 minutes.</strong> If the website says it doesn’t
        recognise the code, use the one on the tracker’s screen now.
      </Note>

      <h2 className="text-xs text-fg tracking-widest uppercase">The lesson</h2>
      <p>
        A few seconds after you add it, the tracker starts a short lesson on the BOOT button. Do what
        each screen says:
      </p>
      <Screens>
        <TrackerScreen name="lessonTap" />
        <TrackerScreen name="lessonHold" />
        <TrackerScreen name="lessonBack" />
        <TrackerScreen name="lessonReady" />
      </Screens>
      <p>Then you’re on the menu. This is where the tracker starts every time from now on.</p>
      <Screens>
        <TrackerScreen name="menu" />
      </Screens>
      <p>
        The tracker is now on your <Link href="/devices">Devices</Link> page (refresh it if it isn’t
        there yet). You can replay the lesson any time from <strong>Settings › How to use</strong>.
      </p>
    </GuidePage>
  )
}
