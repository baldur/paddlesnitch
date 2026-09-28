import type { Metadata } from 'next'
import GuidePage from '@/components/guide/GuidePage'

export const metadata: Metadata = { title: 'Fix it in the boat' }

export default function BoatStep() {
  return (
    <GuidePage slug="boat" title="Fix it in the boat">
      <p>
        Besides GPS, the tracker measures how the boat moves: how much it rolls and pitches, and
        whether it rocks evenly side to side. For that it has to move with the boat, not on its own.
      </p>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li><strong>Fix it firmly in place.</strong> Attached to the boat is best. Otherwise put it
          somewhere it can’t slide or bounce around.</li>
        <li><strong>Any way up is fine.</strong> The tracker works out how it’s mounted from each
          recording, so it doesn’t need to be level or face forward. Just don’t move it during a paddle.</li>
        <li><strong>Keep it reasonably dry.</strong> The case isn’t waterproof. We can send you a
          zip-lock bag if you ask.</li>
        <li>If you want to watch your speed, put it where you can see the screen.</li>
      </ul>
    </GuidePage>
  )
}
