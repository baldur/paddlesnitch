import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import PortageDrawing from '@/components/plan/PortageDrawing'
import PortageSatelliteClient from '@/components/map/PortageSatelliteClient'
import { Page, PageHeader, Section } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { slice } from '@paddlesnitch/waterways/line'
import { loadLevelNear, loadPortageFacts } from '@paddlesnitch/waterways/portage-page-store'
import { SOURCES } from '@paddlesnitch/waterways/sources'
import { addPortageHref, GAUGE_STATE_TEXT, gaugeValueText, portageBankLine, portageMap, stopLines } from '@/lib/plan-ui'
import type { Stop } from '@paddlesnitch/waterways/plan'

// One portage: everything we know about it, on the satellite map and drawn.
// Only public portage details reach this page (portage-page-store.ts).
export const dynamic = 'force-dynamic'

/** How much of the water to draw on the satellite map, each way from the lock. */
const DRAWN_M = 800

const lower = (s: string) => s[0].toLowerCase() + s.slice(1)

type Props = { params: Promise<{ id: string }> }

async function facts(params: Props['params']) {
  const { id } = await params
  return loadPortageFacts(decodeURIComponent(id))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const f = await facts(params)
  if (!f) return { title: 'Portage not found' }
  return { title: f.name, description: `Where to get out and back in at ${f.name}, and what we know about it.` }
}

export default async function PortagePage({ params }: Props) {
  const f = await facts(params)
  if (!f) notFound()
  const { feature, line, portages, alongM, name } = f
  const level = await loadLevelNear(f)
  const first = portages[0]?.ways[0]
  const stop = { feature, leg: 'out', chainageM: alongM, portage: feature.kind !== 'weir' && !feature.noCarry, portages: portages.map(p => p.ways[0].portage) } as unknown as Stop
  const known = stopLines(stop)
  const source = SOURCES[feature.source.source]
  const heading = first?.heading
  return (
    <>
      <div className="print:hidden"><AppHeader breadcrumb={<Link href="/plan" className="tt-nav-link text-sm">← Plan</Link>} /></div>
      {/* .print-sheet is what the site prints; its text is dark for paper, and .no-print goes. */}
      <main className="print-sheet print:[&_*]:!text-black">
        <Page width="wide">
          <PageHeader title={name} eyebrow={feature.kind === 'weir' ? 'Weir' : 'Portage'} description={f.waterways.slice(0, 2).join(', ') || undefined}
            actions={<Link className={`${buttonClass('secondary', 'sm')} no-print`} href={addPortageHref({ id: feature.id, name, at: feature.at })}>{portages.length ? 'Add yours' : 'Add portage details'}</Link>} />

          {line.length > 1 && (
            <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
              <div className="h-72 md:h-96 no-print" data-testid="portage-satellite">
                <PortageSatelliteClient lock={feature.at} line={slice(line, Math.max(0, alongM - DRAWN_M), alongM + DRAWN_M)}
                  carries={portages.map(p => ({ takeOut: p.ways[0].portage.takeOut.at, putIn: p.ways[0].portage.putIn.at }))} />
              </div>
              <figure className="flex flex-col gap-1 break-inside-avoid">
                <PortageDrawing map={portageMap(line, { chainageM: alongM, leg: 'out', feature }, first?.portage, 220)} id={feature.id} name={name} className="w-full max-w-64" />
                {heading && <figcaption className="text-sm text-muted">T is where you get out and P where you get back in, going {heading}.</figcaption>}
              </figure>
            </div>
          )}

          <Section title="Landings">
            <div className="flex flex-col gap-4" data-testid="portage-landings">
              {portages.map(p => {
                const [there, back] = p.ways, c = there.portage
                return (
                  <div key={p.id} className="flex flex-col gap-1">
                    <p className="text-fg">Going {there.heading}: {lower(portageBankLine(there.portage))}</p>
                    <p className="text-fg">Going {back.heading}: {lower(portageBankLine(back.portage))}</p>
                    {c.rollers && <p className="text-fg">Rollers.</p>}
                    {c.notes && <p className="text-fg">{c.notes}</p>}
                    <p className="text-sm text-muted">{c.osm ? 'Mapped in OpenStreetMap · ODbL' : `Added by ${c.by} · CC0`}</p>
                  </div>
                )
              })}
              {portages.length === 0 && !feature.noCarry && <p className="text-muted">Nobody has described the landings here yet.</p>}
              {feature.noCarry && portages.length === 0 && <p className="text-fg">No carry needed.</p>}
            </div>
          </Section>

          {known.length > 0 && (
            <Section title="What else we know">
              <ul className="flex flex-col gap-1 text-fg">{known.map(l => <li key={l}>{l}</li>)}</ul>
            </Section>
          )}

          <Section title="River level now">
            {level.gauge
              ? (
                <p className="text-fg" data-testid="portage-level">
                  {level.gauge.name}: <span className="tabular">{gaugeValueText(level.gauge)}</span>
                  {level.gauge.state && `, ${GAUGE_STATE_TEXT[level.gauge.state]}`}.{' '}
                  <a className="tt-link no-print" href={level.gauge.url} target="_blank" rel="noreferrer">Check this gauge</a>
                </p>
              )
              : <p className="text-muted">{level.unavailable ? "Couldn't read the river level just now." : 'No river gauge near here.'}</p>}
          </Section>

          <Section title="Where this comes from">
            <p className="text-sm text-muted">
              {source
                ? <>Lock details: <a className="tt-link" href={source.url} target="_blank" rel="noreferrer">{source.name}</a> ({source.licence}). </>
                : null}
              <Link className="tt-link no-print" href="/plan/sources">All data sources</Link>
            </p>
          </Section>
        </Page>
      </main>
    </>
  )
}
