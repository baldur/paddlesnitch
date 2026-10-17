import Link from 'next/link'
import type { Metadata } from 'next'
import GuidePage from '@/components/guide/GuidePage'
import { GUIDE_STEPS } from '@/lib/guide'
import { cardLinkClass, Chevron } from '@paddlesnitch/ui/Card'

export const metadata: Metadata = { title: 'Setting up your tracker' }

export default function GuideHome() {
  return (
    <GuidePage title="Setting up your tracker" overview>
      <p>
        This takes about 20 minutes, most of it the first time the tracker looks for GPS. Follow the
        steps in order: the tracker’s code for your account only lasts a few minutes, so the account
        comes first.
      </p>

      <div>
        <h2 className="text-lg font-semibold text-fg mb-2">You need</h2>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>the tracker and a USB-C cable and charger</li>
          <li>a phone with a camera</li>
          <li>WiFi at home. The tracker only uses 2.4 GHz WiFi, which almost every home router has.</li>
        </ul>
      </div>

      <ol className="flex flex-col gap-2">
        {GUIDE_STEPS.map((s, i) => (
          <li key={s.slug}>
            <Link href={`/guide/${s.slug}`} className={`${cardLinkClass} px-4 py-3 flex gap-4 items-center no-underline!`}>
              <span className="text-muted tabular w-5 shrink-0">{i + 1}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-base font-medium text-fg">{s.title}</span>
                <span className="block text-sm text-muted">{s.summary}</span>
              </span>
              <Chevron />
            </Link>
          </li>
        ))}
      </ol>

      <p>
        Something not working? <Link href="/guide/troubleshooting">Troubleshooting</Link> covers the
        problems we know about. The tracker is still being built, so if what you see doesn’t match
        this guide, please tell us with <strong>Report an issue</strong>.
      </p>
    </GuidePage>
  )
}
