import type { Metadata } from 'next'
import Link from 'next/link'
import AppHeader from '@/components/AppHeader'
import PrintSheet from '@/components/plan/PrintSheet'
import { draftFromParams } from '@/lib/plan-ui'

// The printed route sheet, or (crew=1) the crew sheet: the route and timing
// from the address, as on /plan; ?id= (yours) or ?share= adds the plan's
// title and notes. Only the sheet prints (globals.css, "@media print").
export const metadata: Metadata = { title: 'Route sheet' }
export const dynamic = 'force-dynamic'

export default async function PrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v }
  const { draft } = draftFromParams(sp)
  return (
    <>
      <AppHeader breadcrumb={<Link href="/plan" className="tt-nav-link text-sm">← Plan</Link>} />
      <PrintSheet draft={draft} id={one('id')} share={one('share')} crew={one('crew') === '1'} show={one('show')} />
    </>
  )
}
