// @vitest-environment node
// Every analytics event the kayak game can make (games/reading-thames/metrics.js)
// against the server's own rules for them (gameEventProps in
// @paddlesnitch/ui/metrics-events): the server silently drops a prop that
// fails its rule, so a choice added only in the game (a hair style, a course)
// would vanish from the numbers. This fails instead.
import { describe, it, expect } from 'vitest'
import { gameEventProps, GAME_EVENT_PROPS } from '@paddlesnitch/ui/metrics-events'

type Ev = { event: 'game_play' | 'game_kit' | 'game_session'; props: Record<string, string> }
const kept = (e: Ev) => {
  expect(Object.keys(e.props).length, `${e.event}: the route keeps 10 props`).toBeLessThanOrEqual(10)
  expect(gameEventProps(e.event, e.props), `${e.event} ${JSON.stringify(e.props)}`).toEqual(e.props)
}

describe("the kayak game's analytics events pass the server's rules untouched", () => {
  it('every way a play can go: each kind, course, ending, and how the visit began (the walk or the menu)', async () => {
    const { beginPlay, playEvent } = await import('../../../../games/reading-thames/metrics.js')
    type Case = { mode: { key: string; solo?: boolean; drill?: string; outing?: string }; o: { format?: string; live?: boolean } }
    const modes: Case[] = [
      ...['loop', 'hasler79', 'hasler16'].flatMap((key) => [{ mode: { key }, o: { format: 'mass' } }, { mode: { key }, o: { format: 'interval' } }, { mode: { key }, o: { live: true } }]),
      { mode: { key: 'practice', solo: true }, o: {} },
      ...['start', 'wash', 'portage'].map((drill) => ({ mode: { key: `drill-${drill}`, drill, solo: true }, o: {} })),
      ...['cruise', 'hire', 'hire-speedboat', 'hire-launch', 'hire-narrowboat'].map((outing) => ({ mode: { key: outing, outing, solo: true }, o: {} })),
      // The rowing club's: a practice row, the Head of the River (a time trial), a 500 m on the erg.
      { mode: { key: 'row-practice', solo: true }, o: {} },
      { mode: { key: 'row-head' }, o: { format: 'interval' } },
      { mode: { key: 'erg', solo: true }, o: {} },
    ]
    for (const { mode, o } of modes) {
      for (const from of ['walk', 'menu']) {
        for (const end of ['finished', 'quit', 'restart', 'closed']) {
          const play = Object.assign(beginPlay(mode, { ...o, from, now: 10 }), { knocked: 3, bumps: 12, metres: 4321.7 })
          kept(playEvent(play, { end, now: 1234.6, place: mode.solo ? null : 7, swims: 2 }) as Ev)
        }
      }
    }
  })

  it('every paddler choice, and plenty of random paddlers', async () => {
    const { kitEvent } = await import('../../../../games/reading-thames/metrics.js')
    const kit = await import('../../../../games/reading-thames/kit.js')
    const { BOAT_IDS } = kit
    const { DECKS, HULL_SHAPES, PADDLES } = await import('../../../../games/reading-thames/boats.js')
    const base = kit.cleanKit({})
    const options: [string, string[] | boolean[]][] = [
      ['body', Object.keys(kit.BODIES)], ['hair', Object.keys(kit.HAIRS)], ['hat', Object.keys(kit.HATS)], ['beard', Object.keys(kit.BEARDS)],
      ['glasses', Object.keys(kit.GLASSES)], ['sleeves', kit.SLEEVES], ['aid', [true, false]], ['boat', BOAT_IDS],
      ['paddle', Object.keys(PADDLES)], ['deckShape', Object.keys(DECKS)], ['hullShape', Object.keys(HULL_SHAPES)],
    ]
    for (const [field, values] of options) for (const v of values) kept(kitEvent(kit.cleanKit({ ...base, [field]: v })) as Ev)
    for (let i = 0; i < 50; i++) kept(kitEvent(kit.randomKit()) as Ev)
  })

  it('a visit: every place on the walk, every control, each renderer', async () => {
    const { createSession, sessionEvent } = await import('../../../../games/reading-thames/metrics.js')
    const { PLACES } = await import('../../../../games/reading-thames/club.js')
    for (const gpu of ['webgpu', 'webgl2']) {
      const s = createSession(0, 'walk')
      for (const p of Object.keys(PLACES)) s.places.add(p)
      for (const i of ['keys', 'mouse', 'pad', 'touch']) s.inputs.add(i)
      s.plays = 4
      kept(sessionEvent(s, 3725.4, gpu) as Ev)
    }
  })

  it('the server has rules for exactly the props the game sends', async () => {
    const { KIT_FIELDS } = await import('../../../../games/reading-thames/metrics.js')
    expect(Object.keys(GAME_EVENT_PROPS.game_kit).sort()).toEqual([...KIT_FIELDS].sort())
  })
})
