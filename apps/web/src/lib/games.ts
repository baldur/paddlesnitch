// The games listed on /games. Each one is a static folder under games/ at the
// repo root (no build step), deployed to S3 and served at /games/<slug>/.
// games.test.ts fails if a folder and this list disagree.
export type Game = { slug: string; title: string; blurb: string; href: string }

export const GAMES: Game[] = [
  {
    slug: 'reading-thames',
    title: 'Reading Thames',
    blurb: 'Walk from Caversham Bridge to the canoe and rowing clubs at Reading. Race a kayak, row a scull or take a boat up the Thames.',
    href: '/games/reading-thames/',
  },
]
