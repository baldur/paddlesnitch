import type { Metadata } from 'next'
import GuidePage, { Screens } from '@/components/guide/GuidePage'
import TrackerScreen from '@/components/guide/TrackerScreen'

export const metadata: Metadata = { title: 'Charge it and switch it on' }

export default function SwitchOnStep() {
  return (
    <GuidePage slug="switch-on" title="Charge it and switch it on">
      <h2 className="text-xs text-fg tracking-widest uppercase">Charging</h2>
      <p>
        Plug a USB-C charger into the tracker. The battery gauge is in the top right corner of the
        screen, with a lightning bolt while it charges. Charge it before your first paddle.
      </p>

      <h2 className="text-xs text-fg tracking-widest uppercase">The buttons</h2>
      <p>
        <strong>The power button</strong> switches the tracker on (one press) and off (hold it for
        about 6 seconds, until the screen goes dark).
      </p>
      <p>
        <strong>The BOOT button</strong> does everything else, in three ways:
      </p>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li><strong>Tap</strong> moves to the next choice.</li>
        <li><strong>Hold</strong> (about a second, until the screen changes) chooses it.</li>
        <li><strong>Double-tap</strong> goes back.</li>
      </ul>
      <p>The tracker teaches you this with a short lesson once it’s on your account (step 4).</p>

      <h2 className="text-xs text-fg tracking-widest uppercase">Switch it on</h2>
      <p>
        Press the power button. The tracker shows its name for a moment, then, because it doesn’t
        know your WiFi yet, it starts setup:
      </p>
      <Screens>
        <TrackerScreen name="splash" />
        <TrackerScreen name="noWifi" />
      </Screens>
      <p>Then it shows a code for your phone. That’s the next step.</p>
    </GuidePage>
  )
}
