import Link from 'next/link'
import type { Metadata } from 'next'
import GuidePage, { Note, Screens, Steps } from '@/components/guide/GuidePage'
import TrackerScreen from '@/components/guide/TrackerScreen'

export const metadata: Metadata = { title: 'Sync from your phone' }

export default function BluetoothStep() {
  return (
    <GuidePage slug="bluetooth" title="Sync from your phone">
      <p>
        You don’t have to wait until you’re home. Over Bluetooth, your phone can take a paddle off
        the tracker and upload it using your phone’s data. This step is optional: WiFi still works
        as before.
      </p>
      <Note>
        This works in <strong>Chrome</strong> or <strong>Edge</strong> on an Android phone or a
        computer. iPhones and iPads can’t use Bluetooth from a web page yet.
      </Note>

      <h2 className="text-xs text-fg tracking-widest uppercase">Turn Bluetooth on (once)</h2>
      <p>Bluetooth is off until you turn it on. On the tracker:</p>
      <Steps>
        <li>On the menu, choose <strong>Settings</strong>, then <strong>Network</strong>.</li>
        <li>Tap once for the second page, <strong>Settings &gt; Bluetooth</strong>.</li>
        <li>Hold the button. It says <strong>Bluetooth is on</strong>, with the tracker’s Bluetooth name.</li>
      </Steps>
      <Screens>
        <TrackerScreen name="bluetoothOff" />
        <TrackerScreen name="bluetoothOn" />
      </Screens>
      <p>
        It stays on, through restarts and updates. To turn it off, hold the button on the same
        page; the tracker restarts. You can’t change it while you’re recording.
      </p>

      <h2 className="text-xs text-fg tracking-widest uppercase">Pair your phone (once)</h2>
      <Steps>
        <li>
          On your phone, open <Link href="/devices/bluetooth">Devices › Bluetooth</Link> and
          choose <strong>CONNECT</strong>. Pick your tracker from the list.
        </li>
        <li>Choose <strong>PAIR</strong>. A 6-digit number appears on your phone and on the tracker.</li>
        <li>If they match, hold the tracker’s button. You have 25 seconds.</li>
      </Steps>
      <Screens>
        <TrackerScreen name="pair" />
      </Screens>

      <h2 className="text-xs text-fg tracking-widest uppercase">After a paddle</h2>
      <Steps>
        <li>Stop the recording.</li>
        <li>Open <Link href="/devices/bluetooth">Devices › Bluetooth</Link>, choose <strong>CONNECT</strong>, then your tracker.</li>
        <li>
          Choose <strong>SYNC OVER BLUETOOTH</strong> and keep the page open, with the phone near the
          tracker, until it says it’s done. The boat movement data is the big part and can take a
          few minutes.
        </li>
      </Steps>
      <p>
        The tracker marks a paddle as uploaded only once paddlesnitch confirms it has it. If the sync
        stops halfway, nothing is lost: sync again, or let WiFi upload it when you’re home.
      </p>

      <Note>
        The same page can also add a tracker to your account and give it your WiFi details, all
        over Bluetooth. If something doesn’t work, see{' '}
        <Link href="/guide/troubleshooting#bluetooth">troubleshooting</Link>.
      </Note>
    </GuidePage>
  )
}
