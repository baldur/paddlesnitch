import Link from 'next/link'
import type { Metadata } from 'next'
import GuidePage, { Note, Screens, Steps } from '@/components/guide/GuidePage'
import TrackerScreen from '@/components/guide/TrackerScreen'

export const metadata: Metadata = { title: 'Record a paddle' }

export default function RecordStep() {
  return (
    <GuidePage slug="record" title="Record a paddle">
      <Steps>
        <li>Switch the tracker on at the water, outside.</li>
        <li>On the menu, with <strong>Track</strong> chosen, hold the BOOT button.</li>
        <li>Wait for GPS. The satellite in the top left blinks and the bars fill as it finds satellites.</li>
      </Steps>
      <Screens>
        <TrackerScreen name="trackSearching" />
      </Screens>
      <p>
        Outside with open sky this takes 30 to 90 seconds, a little longer the first time. Indoors it
        usually never finds GPS.
      </p>

      <p>
        <strong>As soon as it has GPS, it starts recording by itself.</strong> You don’t press
        anything. The bottom of the screen shows <strong>REC</strong>, the time and the distance.
      </p>
      <Screens>
        <TrackerScreen name="trackRecording" />
      </Screens>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>Tap to change the speed between km/h, m/s and time per 500 m.</li>
        <li>Stroke rate shows <strong>--</strong> on the tracker for now. The website works it out
          from the boat’s movement after you upload.</li>
      </ul>

      <h2 className="text-xs text-fg tracking-widest uppercase">Stopping</h2>
      <Steps>
        <li>Hold the BOOT button. The screen asks <strong>Stop?</strong></li>
        <li>Hold it again. The recording ends and you’re back on the menu.</li>
      </Steps>
      <Screens>
        <TrackerScreen name="stop" />
      </Screens>
      <p>To carry on instead, double-tap, or just wait and it goes back to the recording.</p>

      <Note>
        Double-tapping away from Track does <strong>not</strong> stop the recording. It carries on in
        the background until you go back into Track and stop it. Switching the tracker off also ends
        it, and nothing is lost: it saves every second.
      </Note>

      <p>
        Recordings stay on the tracker’s memory card until they upload. That’s the <Link href="/guide/upload">next step</Link>.
      </p>
    </GuidePage>
  )
}
