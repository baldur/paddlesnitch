import Link from 'next/link'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import GuidePage, { Screens } from '@/components/guide/GuidePage'
import TrackerScreen from '@/components/guide/TrackerScreen'

export const metadata: Metadata = { title: 'Troubleshooting' }

// One problem: what you see, then what to do. `id` makes each one linkable
// (the guide's steps link to #wifi etc.).
function Problem({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="border-t border-border pt-5 flex flex-col gap-3 scroll-mt-4">
      <h2 className="text-sm font-bold text-fg">{title}</h2>
      {children}
    </section>
  )
}

const PROBLEMS: [string, string][] = [
  ['screen', 'The screen stays dark'],
  ['setup', 'I can’t find the tracker’s WiFi, or the setup page doesn’t open'],
  ['wifi', 'The tracker won’t join my WiFi'],
  ['change-wifi', 'I need to change the WiFi network or password'],
  ['code', 'The website doesn’t accept the code'],
  ['gps', 'It says “Acquiring GPS...” and never records'],
  ['sd', 'It says “No SD card”'],
  ['upload', 'My paddle isn’t on the website'],
  ['motion', 'A recording has no boat movement'],
  ['updating', 'It’s stuck on “Updating”'],
  ['reset', 'Starting again from scratch'],
  ['report', 'Something else'],
]

export default function Troubleshooting() {
  return (
    <GuidePage title="Troubleshooting">
      <ul className="flex flex-col gap-1">
        {PROBLEMS.map(([id, title]) => <li key={id}><a href={`#${id}`}>{title}</a></li>)}
      </ul>

      <Problem id="screen" title="The screen stays dark">
        <p>
          Charge it for a while, then press the power button once. If the battery gauge in the top
          right shows a plug instead, the tracker is running from the cable only and switches off
          when you unplug it. Please tell us.
        </p>
      </Problem>

      <Problem id="setup" title="I can’t find the tracker’s WiFi, or the setup page doesn’t open">
        <p>
          The tracker only offers its own <strong>PT-</strong> network while its screen shows the
          WiFi code (<Link href="/guide/wifi">step 3</Link>). If the setup page doesn’t open by itself
          once your phone has joined, open your browser and go to <strong>192.168.4.1</strong>.
        </p>
        <p>Setup waits 10 minutes. After that the tracker shows this; hold BOOT to start setup again:</p>
        <Screens>
          <TrackerScreen name="setupTimedOut" />
        </Screens>
      </Problem>

      <Problem id="wifi" title="The tracker won’t join my WiFi">
        <p>
          It opens setup again and the page says why. Join the <strong>PT-</strong> network on your
          phone again to read it:
        </p>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li><strong>“…the password is probably wrong.”</strong> Enter it again. Passwords are case-sensitive.</li>
          <li><strong>“Can’t see …”</strong> Check the spelling and capitals of the network name, and move
            closer to the router. The tracker can’t use 5 GHz networks.</li>
          <li><strong>“Couldn’t join …”</strong> Check the name, the password, and that the network is 2.4 GHz.</li>
        </ul>
        <p>
          Some networks won’t work at all: ones with a sign-in page (like hotels and cafés) or that
          need a username as well as a password. Your phone’s hotspot works if you set it to 2.4 GHz
          (on iPhone, turn on <strong>Maximise Compatibility</strong>).
        </p>
      </Problem>

      <Problem id="change-wifi" title="I need to change the WiFi network or password">
        <p>
          On the menu choose <strong>Settings</strong>, then <strong>Network</strong>, and hold BOOT on{' '}
          <strong>CHANGE NETWORK</strong>. Setup opens as in <Link href="/guide/wifi">step 3</Link>.
          Leave the password empty to keep the one it has.
        </p>
        <Screens>
          <TrackerScreen name="network" />
        </Screens>
        <p>
          If you type the new password wrong, setup opens again by itself. But if your router’s
          password changes, the tracker can’t tell that from being away from home, so change it here
          straight away.
        </p>
      </Problem>

      <Problem id="code" title="The website doesn’t accept the code">
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li><strong>“We don’t recognise that code.”</strong> The code changes about every 5 minutes.
            Use the one on the tracker’s screen now.</li>
          <li><strong>“That code has expired.”</strong> The same: use the code on the screen now.</li>
          <li><strong>“That code has already been used.”</strong> The tracker is probably on your
            account already. Check <Link href="/devices">Devices</Link>.</li>
        </ul>
        <p>
          If the tracker says <strong>getting a code...</strong> for more than a minute, it can’t
          reach the internet. <strong>wifi: check password</strong> means it couldn’t join your WiFi:
          switch it off and on, and it opens setup so you can correct the password.
        </p>
        <p>A tap switches the code between the picture and the letters.</p>
      </Problem>

      <Problem id="gps" title="It says “Acquiring GPS...” and never records">
        <p>
          The tracker needs a clear view of the sky. Take it outside, away from tall buildings, and
          give it up to a couple of minutes. The bars at the top fill as it finds satellites. It
          won’t find GPS indoors, and it only records once it has.
        </p>
      </Problem>

      <Problem id="sd" title="It says “No SD card”">
        <p>
          The tracker saves recordings to a memory card, and without one it can’t record. Check the
          card is pushed fully into its slot, then switch the tracker off and on. If that doesn’t
          fix it, tell us.
        </p>
      </Problem>

      <Problem id="upload" title="My paddle isn’t on the website">
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>Is the tracker switched on, in range of your WiFi, and <strong>not</strong> recording?
            It doesn’t upload while recording.</li>
          <li>Open <strong>Sync</strong> on the tracker. <strong>pending</strong> should count down to 0.
            Hold BOOT for <strong>SYNC NOW</strong> to start it.</li>
          <li>Uploaded recordings are on your tracker’s page under <Link href="/devices">Devices</Link>.
            They only appear under <strong>Paddles</strong> once you add them there
            (<Link href="/guide/upload">step 7</Link>).</li>
        </ul>
        <p>
          A recording the website can’t use, like one made indoors with no GPS, isn’t counted as
          pending. The second page of <strong>Sync</strong> lists how many <strong>couldn’t be
          used</strong>, and keeps them on the card. If <strong>pending</strong> stays above 0 for
          half an hour on WiFi, tell us.
        </p>
      </Problem>

      <Problem id="motion" title="A recording has no boat movement">
        <p>
          The recording’s page says <strong>No boat motion for this recording.</strong> The motion
          sensor can stop working after the tracker restarts itself (after setup, an update or a
          reset). Switch the tracker off with the power button and on again before your next paddle.
          That fixes it.
        </p>
      </Problem>

      <Problem id="updating" title="It’s stuck on “Updating”">
        <p>
          While an update downloads, the screen shows <strong>Updating</strong>, a progress bar and{' '}
          <strong>keep powered, buttons off</strong>. The buttons do nothing until it’s finished.
          If it sits at <strong>0%</strong> for more than a few minutes,
          switch it off and on. An update that fails is safe: the tracker goes back to the version it
          had.
        </p>
      </Problem>

      <Problem id="reset" title="Starting again from scratch">
        <p>
          <strong>Settings</strong>, then <strong>Factory reset</strong>, then hold BOOT to confirm. It
          forgets your WiFi and your account, and keeps the recordings on its card. Then follow the
          guide again from <Link href="/guide/wifi">step 3</Link>.
        </p>
        <Screens>
          <TrackerScreen name="reset" />
        </Screens>
        <p>
          Removed the tracker from your account on the website? It can’t upload after that, so do a
          factory reset and add it again.
        </p>
      </Problem>

      <Problem id="report" title="Something else">
        <p>
          Tell us with <strong>Report an issue</strong>. It helps to say what the tracker’s screen
          showed and roughly when, and which tracker it was: the ID is on your{' '}
          <Link href="/devices">Devices</Link> page.
        </p>
      </Problem>
    </GuidePage>
  )
}
