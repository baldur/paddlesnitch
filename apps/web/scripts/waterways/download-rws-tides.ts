#!/usr/bin/env node
// Download a year of measured water heights (10-minute, cm above NAP) for the
// Dutch tide gauges fit-tides.ts uses, from Rijkswaterstaat's DDL 2.0 (keyless,
// open data), one month per request. Writes .cache/waterways/tides/rws/{code}.json
// as [{ t, h }] in ms and metres. Run yearly, before `pnpm waterways:tides`.
//
//   pnpm --filter web exec tsx scripts/waterways/download-rws-tides.ts [--months 12] [--only <gauge id>]
import fs from 'fs'
import path from 'path'
import { RWS_TIDE_GAUGES } from '@paddlesnitch/waterways/tide'

const URL = 'https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen'
const OUT = path.join(process.cwd(), '.cache/waterways/tides/rws')
const args = process.argv.slice(2)
const months = Number(args.includes('--months') ? args[args.indexOf('--months') + 1] : 12) || 12
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined

type Resp = { WaarnemingenLijst?: { AquoMetadata?: { ProcesType?: string }; MetingenLijst?: { Tijdstip: string; Meetwaarde?: { Waarde_Numeriek?: number } }[] }[] }

async function month(code: string, from: Date, to: Date): Promise<{ t: number; h: number }[]> {
  const res = await fetch(URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'paddlesnitch-river-planner (+https://paddlesnitch.com/plan)' },
    body: JSON.stringify({
      Locatie: { Code: code },
      AquoPlusWaarnemingMetadata: { AquoMetadata: { Compartiment: { Code: 'OW' }, Grootheid: { Code: 'WATHTE' }, ProcesType: 'meting' } },
      Periode: { Begindatumtijd: from.toISOString().replace('Z', '+00:00'), Einddatumtijd: to.toISOString().replace('Z', '+00:00') },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (res.status === 204) return []
  if (!res.ok) throw new Error(`${res.status} ${code} ${from.toISOString().slice(0, 7)}`)
  const body = await res.json() as Resp
  return (body.WaarnemingenLijst ?? []).flatMap(w => (w.MetingenLijst ?? []).flatMap(m => {
    const v = m.Meetwaarde?.Waarde_Numeriek, t = Date.parse(m.Tijdstip)
    return typeof v === 'number' && Math.abs(v) < 2000 && Number.isFinite(t) ? [{ t, h: v / 100 }] : []
  }))
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const end = new Date(); end.setUTCHours(0, 0, 0, 0)
  for (const [id, g] of Object.entries(RWS_TIDE_GAUGES)) {
    if (only && id !== only) continue
    const all = new Map<number, number>()
    for (let i = months; i > 0; i--) {
      const from = new Date(end), to = new Date(end)
      from.setUTCMonth(end.getUTCMonth() - i); to.setUTCMonth(end.getUTCMonth() - i + 1)
      try { for (const s of await month(g.code, from, to)) all.set(s.t, s.h) } catch (e) { console.log(`  ${g.label}: ${(e as Error).message}`) }
    }
    const series = [...all].map(([t, h]) => ({ t, h })).sort((a, b) => a.t - b.t)
    fs.writeFileSync(path.join(OUT, `${g.code}.json`), JSON.stringify(series))
    console.log(`  ${g.label}: ${series.length} readings`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
