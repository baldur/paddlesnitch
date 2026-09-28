// The ?campaign=betatesters marketing landing.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/components/AttAccountNav', () => ({ default: () => <span>ACCOUNTNAV</span> }))
vi.mock('@/lib/auth', () => ({ getAuthUser: vi.fn() }))
vi.mock('@paddlesnitch/api', () => ({
  createCaller: () => ({ paddles: { list: async () => ({ cards: [] }) } }),
}))

import { getAuthUser } from '@/lib/auth'
const { default: LandingPage, generateMetadata } = await import('@/app/page')
const { default: BetaTestersLanding } = await import('@/components/campaigns/BetaTestersLanding')

const render = async (campaign?: string) =>
  renderToStaticMarkup(await LandingPage({ searchParams: Promise.resolve(campaign ? { campaign } : {}) }))

beforeEach(() => vi.mocked(getAuthUser).mockResolvedValue(null))

describe('beta testers landing', () => {
  const html = renderToStaticMarkup(<BetaTestersLanding />)

  it('plays the tracker video muted, looped and inline behind the content, hidden for reduced motion', () => {
    expect(html).toMatch(/<video[^>]*src="\/campaigns\/betatesters.mp4"/)
    for (const attr of ['autoPlay', 'muted', 'loop', 'playsInline']) {
      expect(html.toLowerCase()).toContain(attr.toLowerCase())
    }
    expect(html).toContain('motion-reduce:hidden')
    expect(html).toContain('poster="/campaigns/betatesters.jpg"')
  })

  it('states both requirements: paddle regularly, tracker fixed firmly in the boat', () => {
    expect(html).toContain('Test the paddlesnitch tracker')
    // No small heading line above the card titles.
    expect(html).not.toMatch(/Beta testers wanted|You paddle<|It sits firmly in the boat</)
    expect(html).toContain('You kayak, canoe, row or paddleboard')
    expect(html).toContain('sit firmly in the boat')
    expect(html).toContain('Attached is best')
    expect(html).toContain('reasonably dry')
  })

  it('shows one card at a time: all three are in the page, only the first is visible', () => {
    expect((html.match(/aria-roledescription="slide"/g) ?? []).length).toBe(3)
    expect((html.match(/<article hidden=""/g) ?? []).length).toBe(2)
    expect(html).toContain('aria-label="Previous"')
    expect(html).toContain('aria-label="Next"')
  })

  it('shows a CLICK TO SNITCH button, with the form kept in a pop-up until it is pressed', () => {
    expect(html).toContain('CLICK TO SNITCH')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('role="dialog"')
  })
})

describe('the front door with ?campaign=betatesters', () => {
  it('serves the beta testers landing to a signed-out visitor', async () => {
    expect(await render('betatesters')).toContain('data-campaign="betatesters"')
  })

  it('serves it to a signed-in paddler too, instead of their dashboard', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ id: 'u', email: 'a@b.c', displayName: 'Ann' })
    const html = await render('betatesters')
    expect(html).toContain('data-campaign="betatesters"')
    expect(html).not.toContain('ANN’S PADDLES')
  })

  it('still sends a signed-in paddler with no campaign to their dashboard', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ id: 'u', email: 'a@b.c', displayName: 'Ann' })
    expect(await render()).not.toContain('data-campaign')
  })

  it('gives the campaign link its own title and share image', async () => {
    const meta = await generateMetadata({ searchParams: Promise.resolve({ campaign: 'betatesters' }) })
    expect(meta.title).toBe('Beta testers wanted — paddlesnitch')
    expect(JSON.stringify(meta.openGraph)).toContain('/campaigns/betatesters.jpg')
    const plain = await generateMetadata({ searchParams: Promise.resolve({}) })
    expect(plain.title).toBe('paddlesnitch.com — tools for the river')
  })
})
