import BetaApplyModal from './BetaApplyModal'

// The ?campaign=betatesters landing: the tracker video playing behind square
// message boxes, and a CLICK TO SNITCH button that opens the form in a pop-up.
//
// The video is muted, looped and inline (required for autoplay on phones). With
// reduced motion the video is hidden and the poster frame shows instead.

const TILES: { eyebrow: string; title: string; body: string }[] = [
  {
    eyebrow: 'Beta testers wanted',
    title: 'Test the paddlesnitch tracker',
    body: 'A small GPS and motion tracker that records your paddle and uploads it on its own. We need paddlers to take it on the water and tell us what works and what breaks.',
  },
  {
    eyebrow: '1 · You paddle',
    title: 'You get out on the water',
    body: 'You kayak, canoe, row or paddleboard, and you go out regularly enough to give the tracker real use.',
  },
  {
    eyebrow: '2 · It sits firmly in the boat',
    title: 'Fixed in place',
    body: 'The tracker measures how the boat moves, so it needs to sit firmly in the boat. Attached is best; otherwise somewhere it won’t slide or bounce around. It also needs to stay reasonably dry.',
  },
]

export default function BetaTestersLanding() {
  return (
    <section className="relative flex-1 overflow-hidden min-h-[calc(100svh-6rem)]" data-campaign="betatesters">
      {/* Poster frame: the background under reduced motion, and while the video loads. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/campaigns/betatesters.jpg)' }}
      />
      <video
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover motion-reduce:hidden"
        src="/campaigns/betatesters.mp4"
        poster="/campaigns/betatesters.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      />
      {/* Darken the video so the text reads on any frame. */}
      <div aria-hidden="true" className="absolute inset-0 bg-bg/45" />

      <div className="relative px-4 py-10 md:py-16 max-w-5xl mx-auto w-full flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          {TILES.map((t, i) => (
            <article
              key={t.eyebrow}
              className={`md:aspect-square border bg-bg/80 backdrop-blur-sm p-6 flex flex-col gap-3 ${i === 0 ? 'border-primary' : 'border-border'}`}
            >
              <p className={`text-[10px] tracking-[0.3em] uppercase ${i === 0 ? 'text-fg' : 'text-muted'}`}>{t.eyebrow}</p>
              {i === 0
                ? <h1 className="text-2xl font-bold text-fg leading-tight">{t.title}</h1>
                : <h2 className="text-lg md:text-xl font-bold text-fg leading-tight">{t.title}</h2>}
              <p className="text-sm text-muted leading-relaxed">{t.body}</p>
            </article>
          ))}
        </div>

        <div className="flex justify-center pt-4">
          <BetaApplyModal />
        </div>
      </div>
    </section>
  )
}
