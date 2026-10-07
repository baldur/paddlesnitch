// The tracker setup guide (/guide): the steps, in order. One list, so the
// overview, the step numbers and the BACK/NEXT links can't disagree.

export type GuideStep = { slug: string; title: string; summary: string }

export const GUIDE_STEPS: readonly GuideStep[] = [
  { slug: 'account', title: 'Create your account', summary: 'Do this first, before you switch the tracker on.' },
  { slug: 'switch-on', title: 'Charge it and switch it on', summary: 'The buttons, the battery, and the short lesson on the screen.' },
  { slug: 'wifi', title: 'Connect it to your WiFi', summary: 'Your phone joins the tracker, then you tell it your home network.' },
  { slug: 'link', title: 'Add it to your account', summary: 'Scan the code on the screen so its paddles come to you.' },
  { slug: 'boat', title: 'Fix it in the boat', summary: 'Firmly in place, and reasonably dry.' },
  { slug: 'record', title: 'Record a paddle', summary: 'Open Track, wait for GPS, paddle, stop.' },
  { slug: 'upload', title: 'Upload it and look at it', summary: 'Back home it uploads by itself; then see it on the website.' },
  { slug: 'bluetooth', title: 'Sync from your phone', summary: 'Optional: send a paddle home by Bluetooth, before you’re back on WiFi.' },
]

export function guideStep(slug: string): { step: GuideStep; number: number; prev?: GuideStep; next?: GuideStep } | undefined {
  const i = GUIDE_STEPS.findIndex(s => s.slug === slug)
  if (i < 0) return undefined
  return { step: GUIDE_STEPS[i], number: i + 1, prev: GUIDE_STEPS[i - 1], next: GUIDE_STEPS[i + 1] }
}

// The "getting started" checklist on /devices: how far a new tester has got,
// each item linking to the guide step that does it. Derived from what the page
// already loads (the viewer's trackers and their recordings), so it ticks
// itself off; it disappears once a recording has arrived.
export type SetupItem = { label: string; href: string; done: boolean }

export function setupProgress(trackers: { linked: boolean; sessions: number }[], hasTrackerPaddle = false): { items: SetupItem[]; complete: boolean } {
  const items: SetupItem[] = [
    { label: 'Create your account', href: '/guide/account', done: true },   // they are on a signed-in page
    { label: 'Set up your tracker and add it here', href: '/guide/switch-on', done: trackers.some(t => t.linked) },
    // A paddle, not just any recording: a desk test uploads too but never
    // becomes a paddle, and ticking this for it ended the checklist with
    // nothing to look at (one-paddle.md).
    { label: 'Record a paddle and see it in Paddles', href: '/guide/record', done: hasTrackerPaddle },
  ]
  return { items, complete: items.every(i => i.done) }
}
