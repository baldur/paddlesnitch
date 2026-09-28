import Link from 'next/link'
import type { Metadata } from 'next'
import GuidePage, { Note, Screens, Steps } from '@/components/guide/GuidePage'
import TrackerScreen from '@/components/guide/TrackerScreen'

export const metadata: Metadata = { title: 'Connect it to your WiFi' }

export default function WifiStep() {
  return (
    <GuidePage slug="wifi" title="Connect it to your WiFi">
      <p>
        The tracker uploads your paddles over your home WiFi. To tell it which network to use, your
        phone first joins a small WiFi network the tracker makes itself.
      </p>

      <Screens>
        <TrackerScreen name="joinWifi" caption="Your tracker shows its own network name and password" />
      </Screens>

      <Steps>
        <li>
          Point your phone’s camera at the code on the tracker and tap <strong>Join</strong>. (Or open
          your phone’s WiFi settings and join the network named on the screen, starting <strong>PT-</strong>,
          with the password under it.)
        </li>
        <li>
          A setup page opens by itself. If it doesn’t, open your browser and go to <strong>192.168.4.1</strong>.
          Your phone may warn that this network has no internet. That’s expected: stay on it.
        </li>
        <li>Under <strong>Your WiFi network</strong>, pick your home network, then enter its password.</li>
        <li>Choose <strong>Save and connect</strong>.</li>
      </Steps>

      <p>The tracker restarts and joins your WiFi:</p>
      <Screens>
        <TrackerScreen name="joining" />
        <TrackerScreen name="connected" />
      </Screens>
      <p>
        <strong>Account: not linked</strong> is right at this point. Your phone goes back to its
        usual WiFi by itself.
      </p>

      <Note>
        <strong>Network not in the list?</strong> The tracker can only use 2.4 GHz WiFi. Most routers
        give 2.4 GHz and 5 GHz the same name, so if yours isn’t listed, move closer to the router and
        try again. Network names are case-sensitive, and phones like to
        capitalise the first letter.
      </Note>

      <p>
        If the tracker can’t join, it opens setup again and the page says why (usually the
        password). Join the <strong>PT-</strong> network on your phone again and correct it. More in{' '}
        <Link href="/guide/troubleshooting#wifi">troubleshooting</Link>.
      </p>
    </GuidePage>
  )
}
