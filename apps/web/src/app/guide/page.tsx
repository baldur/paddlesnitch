import Link from 'next/link'
import type { Metadata } from 'next'
import GuidePage from '@/components/guide/GuidePage'
import { GUIDE_STEPS } from '@/lib/guide'

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
        <h2 className="text-xs text-fg tracking-widest uppercase mb-2">You need</h2>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>the tracker and a USB-C cable and charger</li>
          <li>a phone with a camera</li>
          <li>WiFi at home. The tracker only uses 2.4 GHz WiFi, which almost every home router has.</li>
        </ul>
      </div>

      <ol className="flex flex-col gap-2">
        {GUIDE_STEPS.map((s, i) => (
          <li key={s.slug}>
            <Link href={`/guide/${s.slug}`} className="border border-border px-4 py-3 flex gap-4 items-baseline hover:bg-surface transition-colors">
              <span className="text-muted tabular">{i + 1}</span>
              <span className="min-w-0">
                <span className="block text-fg">{s.title}</span>
                <span className="block text-xs text-muted">{s.summary}</span>
              </span>
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
