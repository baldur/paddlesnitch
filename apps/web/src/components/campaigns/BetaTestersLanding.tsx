import BetaSlides, { type Slide } from './BetaSlides'

// The ?campaign=betatesters landing: the tracker video playing behind one
// message card at a time (flip with the side arrows), and a CLICK TO SNITCH
// button that opens the form in a pop-up and bounces on the last card.
//
// The video is muted, looped and inline (required for autoplay on phones). With
// reduced motion the video is hidden and the poster frame shows instead.

const SLIDES: Slide[] = [
  {
    title: 'Test the paddlesnitch tracker',
    body: 'A small GPS and motion tracker that records your paddle and uploads it on its own. We need paddlers to take it on the water and tell us what works and what breaks.',
  },
  {
    title: 'You get out on the water',
    body: 'You kayak, canoe, row or paddleboard, and you go out regularly enough to give the tracker real use.',
  },
  {
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

      <div className="relative px-4 py-10 md:py-16 w-full flex flex-col items-center">
        <BetaSlides slides={SLIDES} />
      </div>
    </section>
  )
}
