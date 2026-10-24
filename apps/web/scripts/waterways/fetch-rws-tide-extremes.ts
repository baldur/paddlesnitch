#!/usr/bin/env node
// Rijkswaterstaat's predicted high and low waters (GETETBRKD2, astronomical,
// open data) for the Dutch tide gauges, from yesterday to ~14 months ahead.
// Writes .cache/waterways/tides-nl.json; build-national.ts publishes it with the
// data version as `tides-nl`. Run by the weekly refresh, so it never runs out.
//
//   pnpm --filter web exec tsx scripts/waterways/fetch-rws-tide-extremes.ts
import fs from 'fs'
import path from 'path'
import { compactExtremes, RWS_TIDE_GAUGES, type OfficialTides } from '@paddlesnitch/waterways/tide'

const URL = 'https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen'
const OUT = path.join(process.cwd(), '.cache/waterways/tides-nl.json')
const DAY = 86_400_000

async function extremes(code: string, from: Date, to: Date): Promise<{ t: number; h: number }[]> {
  const res = await fetch(URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'paddlesnitch-river-planner (+https://paddlesnitch.com/plan)' },
    body: JSON.stringify({
      Locatie: { Code: code },
      AquoPlusWaarnemingMetadata: { AquoMetadata: { Compartiment: { Code: 'OW' }, Grootheid: { Code: 'WATHTE' }, Groepering: { Code: 'GETETBRKD2' }, ProcesType: 'astronomisch' } },
      Periode: { Begindatumtijd: from.toISOString().replace('Z', '+00:00'), Einddatumtijd: to.toISOString().replace('Z', '+00:00') },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (res.status === 204) return []
  if (!res.ok) throw new Error(`${res.status} ${code}`)
  const body = await res.json() as { WaarnemingenLijst?: { MetingenLijst?: { Tijdstip: string; Meetwaarde?: { Waarde_Numeriek?: number } }[] }[] }
  return (body.WaarnemingenLijst ?? []).flatMap(w => (w.MetingenLijst ?? []).flatMap(m => {
    const v = m.Meetwaarde?.Waarde_Numeriek, t = Date.parse(m.Tijdstip)
    return typeof v === 'number' && Math.abs(v) < 2000 && Number.isFinite(t) ? [{ t, h: v / 100 }] : []
  }))
}

async function main() {
  const start = Date.now() - DAY
  const gauges: OfficialTides['gauges'] = {}
  for (const [id, g] of Object.entries(RWS_TIDE_GAUGES)) {
    const seen = new Map<number, number>()
    for (let q = 0; q < 5; q++) {   // five quarters ahead, one request each
      try {
        for (const e of await extremes(g.code, new Date(start + q * 91 * DAY), new Date(start + (q + 1) * 91 * DAY))) seen.set(e.t, e.h)
      } catch (e) { console.log(`  ${g.label}: ${(e as Error).message}`) }
    }
    if (!seen.size) { console.log(`  ${g.label}: no predictions`); continue }
    const list = [...seen].map(([t, h]) => ({ t, h }))
    gauges[id] = { label: g.label, at: g.at, ...compactExtremes(list) }
    console.log(`  ${g.label}: ${list.length} high and low waters to ${new Date(Math.max(...seen.keys())).toISOString().slice(0, 10)}`)
  }
  const out: OfficialTides = { fetchedAt: new Date().toISOString(), credit: 'Predicted tides: Rijkswaterstaat (open data)', gauges }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out))
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1e3).toFixed(0)} KB)`)
}

main().catch(e => { console.error(e); process.exit(1) })
