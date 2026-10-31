// The games listed on /games. Each one is a static folder under games/ at the
// repo root (no build step), deployed to S3 and served at /games/<slug>/.
// games.test.ts fails if a folder and this list disagree.
export type Game = { slug: string; title: string; blurb: string; href: string }

export const GAMES: Game[] = [
  {
    slug: 'kayak',
    title: 'Kayak',
    blurb: 'Walk down to the canoe club at Reading. Race the Hasler courses, practise a drill or take a boat up the Thames.',
    href: '/games/kayak/',
  },
]
