import { cache } from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import PortageDrawing from '@/components/plan/PortageDrawing'
import PortageFlag from '@/components/plan/PortageFlag'
import PortageSatelliteClient from '@/components/map/PortageSatelliteClient'
import { Page, PageHeader, Section } from '@paddlesnitch/ui/Layout'
import { buttonClass } from '@paddlesnitch/ui/Button'
import { fmtDay } from '@paddlesnitch/core/format'
import { slice } from '@paddlesnitch/waterways/line'
import { ageText, decodePortageId, KIND_NAME, portageCredits, realWaterways } from '@paddlesnitch/waterways/portage-page'
import { loadGaugeNear, loadPortageFacts } from '@paddlesnitch/waterways/portage-page-store'
import { SURVEY_NAME } from '@paddlesnitch/waterways/portage-survey'
import { addPortageHref, GAUGE_STATE_TEXT, gaugeValueText, km, portageMap, portagePageHref, portageWayLine, safeBack, stopLines } from '@/lib/plan-ui'
import type { Stop } from '@paddlesnitch/waterways/plan'

// One portage: everything we know about it, on the satellite map and drawn.
// Only public portage details reach this page (portage-page-store.ts).
export const dynamic = 'force-dynamic'

/** How much of the water to draw on the satellite map, each way from the lock. */
const DRAWN_M = 800

/** On paper "ago" means nothing. UTC, because the server doesn't know the reader's zone. */
const gaugeReadAt = (iso: string) => { const t = new Date(iso).toISOString(); return `${fmtDay(t)}, ${t.slice(11, 16)} UTC` }

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

// Metadata and the page both need it: once per request.
const factsFor = cache(async (raw: string) => {
  const id = decodePortageId(raw)
  return id === null ? null : loadPortageFacts(id)
})

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const f = await factsFor((await params).id)
  if (!f) return { title: 'Portage not found' }
  return { title: f.name, description: f.portages.length ? `Where to get out and back in at ${f.name}, and what we know about it.` : `What we know about ${f.name}.` }
}

export default async function PortagePage({ params, searchParams }: Props) {
  const { id } = await params
  const f = await factsFor(id)
  if (!f) notFound()
  const { back } = await searchParams
  const backTo = safeBack(back)
  const { feature, line, portages, alongM, name } = f
  const near = await loadGaugeNear(f)
  const gauge = near.gauge
  const first = portages[0]?.ways[0]
  const stop = { feature, leg: 'out', chainageM: alongM, portage: !!feature.portage?.side, portages: portages.map(p => p.ways[0].portage) } as unknown as Stop
  const known = stopLines(stop)
  const credits = portageCredits(f, gauge?.source)
  const here = portagePageHref(feature.id, backTo)
  const water = realWaterways(f.waterways).slice(0, 2).join(', ')
  return (
    <>
      <div className="print:hidden">
        <AppHeader breadcrumb={<Link href={backTo} className="tt-nav-link text-sm inline-flex items-center min-h-11">← Plan</Link>} />
      </div>
      {/* .print-sheet is what the site prints; its text is dark for paper, and .no-print goes. */}
      <main className="print-sheet print:[&_*]:!text-black">
        <Page width="wide">
          <PageHeader title={name} eyebrow={KIND_NAME[feature.kind] ?? 'Portage'} description={water || undefined}
            actions={<Link className={`${buttonClass('secondary', 'sm')} no-print`} href={addPortageHref({ id: feature.id, name, at: feature.at })}>{portages.length ? 'Add yours' : 'Add landings'}</Link>} />

          {line.length > 1 && (
            <div className={`grid gap-4 ${first ? 'md:grid-cols-[1fr_16rem]' : ''}`}>
              <div className="h-72 md:h-96 no-print" data-testid="portage-satellite">
                <PortageSatelliteClient lock={feature.at} name={name} line={slice(line, Math.max(0, alongM - DRAWN_M), alongM + DRAWN_M)}
                  carries={portages.map(p => ({ takeOut: p.ways[0].portage.takeOut.at, putIn: p.ways[0].portage.putIn.at }))} />
              </div>
              {first && (
                <figure className="flex flex-col gap-1 break-inside-avoid">
                  <PortageDrawing map={portageMap(line, { chainageM: alongM, leg: 'out', feature }, first.portage, 220)} id={feature.id} name={name} className="w-full max-w-64" />
                  <figcaption className="text-sm text-muted">Going towards {first.towards}, T is where you get out and P where you get back in. Going the other way, they swap.</figcaption>
                </figure>
              )}
            </div>
          )}

          <Section title="Landings">
            <div className="flex flex-col gap-4" data-testid="portage-landings">
              {portages.map(p => {
                const [there, back] = p.ways, c = there.portage
                return (
                  <div key={p.id} className="flex flex-col gap-1">
                    <p className="text-fg">Towards {there.towards}: {portageWayLine(there.portage)}</p>
                    <p className="text-fg">Towards {back.towards}: {portageWayLine(back.portage)}</p>
                    {c.rollers && <p className="text-fg">Rollers.</p>}
                    {c.notes && <p className="text-fg">{c.notes}</p>}
                    <p className="text-sm text-muted">
                      {c.osm ? 'Mapped in OpenStreetMap · ODbL' : c.by === SURVEY_NAME ? 'From a paddlesnitch survey' : `Added by ${c.by} · CC0`}
                      {!c.osm && <PortageFlag id={p.id} here={here} />}
                    </p>
                  </div>
                )
              })}
              {portages.length === 0 && (feature.noCarry
                ? <p className="text-fg">Usually no carry. If the river is very high, carry round.</p>
                : <p className="text-muted">Nobody has described the landings here yet.</p>)}
            </div>
          </Section>

          {known.length > 0 && (
            <Section title="What else we know">
              <ul className="flex flex-col gap-1 text-fg">{known.map(l => <li key={l}>{l}</li>)}</ul>
            </Section>
          )}

          <Section title="Nearest gauge">
            {gauge
              ? (
                <div className="flex flex-col gap-1" data-testid="portage-level">
                  <p className="text-fg">
                    {gauge.name}{near.awayM !== undefined && `, ${km(near.awayM)} along the water`}: <span className="tabular">{gaugeValueText(gauge)}</span>
                    {gauge.state && !near.stale && `, ${GAUGE_STATE_TEXT[gauge.state]}`}.
                    {near.ageMin !== undefined && <span className="no-print"> Read {ageText(near.ageMin)} ago.</span>}
                    {gauge.readAt && <span className="hidden print:inline"> Read {gaugeReadAt(gauge.readAt)}.</span>}{' '}
                    <a className="tt-link no-print" href={gauge.url} target="_blank" rel="noreferrer">Check this gauge</a>
                  </p>
                  {near.stale && <p className="text-fg">This reading is old, so it may not show the river now.</p>}
                </div>
              )
              : <p className="text-muted">{near.unavailable ? "Couldn't read the river level. Please try again later." : 'No river gauge near here.'}</p>}
          </Section>

          {credits.length > 0 && (
            <Section title="Where this comes from">
              <p className="text-sm text-muted" data-testid="portage-credits">
                {credits.join(' ')} <Link className="tt-link no-print" href="/plan/sources">All data sources</Link>
              </p>
            </Section>
          )}
        </Page>
      </main>
    </>
  )
}
