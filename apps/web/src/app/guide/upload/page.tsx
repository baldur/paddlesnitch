import Link from 'next/link'
import type { Metadata } from 'next'
import GuidePage, { Note, Screens, Steps } from '@/components/guide/GuidePage'
import TrackerScreen from '@/components/guide/TrackerScreen'

export const metadata: Metadata = { title: 'Upload it and look at it' }

export default function UploadStep() {
  return (
    <GuidePage slug="upload" title="Upload it and look at it">
      <p>
        When the tracker is in range of your WiFi it uploads new recordings by itself: when you
        switch it on, when you stop a recording, and every 5 minutes. It never uploads while it’s
        recording.
      </p>
      <p>
        So after a paddle, bring it home and leave it switched on, ideally charging. The boat
        movement data is the big part and can take several minutes.
      </p>
      <p>
        Away from WiFi? Your phone can send it over Bluetooth instead: see{' '}
        <Link href="/guide/bluetooth">Sync from your phone</Link>.
      </p>

      <h2 className="text-xs text-fg tracking-widest uppercase">Checking on the tracker</h2>
      <p>On the menu, choose <strong>Sync</strong>:</p>
      <Screens>
        <TrackerScreen name="sync" />
      </Screens>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li><strong>pending</strong> is how many recordings haven’t uploaded yet. When it reaches 0, you’re done.</li>
        <li>Hold BOOT for <strong>SYNC NOW</strong> to upload straight away.</li>
        <li>Tap for the second page, where <strong>DELETE UPLOADED</strong> clears recordings that
          are already uploaded off the tracker. It never deletes one that isn’t.</li>
      </ul>

      <h2 className="text-xs text-fg tracking-widest uppercase">On the website</h2>
      <p>
        Each paddle appears in <Link href="/paddles">Paddles</Link> by itself, a minute or so after the
        tracker uploads it: the map, splits, efforts and rests, the conditions that day and a written
        summary. Its boat movement data follows a few minutes later and adds stroke rate and{' '}
        <strong>BOAT MOTION</strong>.
      </p>
      <p>
        A recording where the boat barely moved, like a test at home, doesn&apos;t become a paddle. It
        stays on your tracker&apos;s page under <Link href="/devices">Devices</Link>.
      </p>

      <h2 className="text-xs text-fg tracking-widest uppercase">Updates</h2>
      <p>
        The tracker updates itself over WiFi when there’s a new version. It shows this screen
        afterwards, saying what changed. Press any button to carry on.
      </p>
      <Screens>
        <TrackerScreen name="updated" />
      </Screens>

      <Note>
        That’s the setup done. If something doesn’t work the way this guide says, see{' '}
        <Link href="/guide/troubleshooting">troubleshooting</Link>, or tell us with{' '}
        <strong>Report an issue</strong>.
      </Note>
    </GuidePage>
  )
}
