import Link from 'next/link'
import AppHeader from '@/components/AppHeader'
import { Page, PageHeader, Section } from '@paddlesnitch/ui/Layout'
import { cardClass } from '@paddlesnitch/ui/Card'
import { openApi } from '@/lib/api-v1-openapi'
import { SITE } from '@/lib/discovery'

// The public read-only API's docs (#511, #513), rendered from the same
// OpenAPI description the API serves, so the two can't drift.
export const metadata = {
  title: 'API',
  description: 'paddlesnitch’s free, read-only JSON API: plan a paddle, find places on the water, and read public time trials. No key needed.',
}

type Param = { name: string; in: string; required?: boolean; description?: string; example?: string; schema?: { enum?: string[]; default?: unknown } }
type Op = { summary: string; description?: string; parameters?: Param[]; responses: Record<string, { description: string }> }

const EXAMPLES: Record<string, string> = {
  '/api/v1/plan': '/api/v1/plan?from=cropredy-lock&to=banbury&shape=return&pace=7',
  '/api/v1/places': '/api/v1/places?q=Cropredy',
  '/api/v1/trials': '/api/v1/trials?status=open',
}

export default function ApiPage() {
  const spec = openApi(SITE)
  const paths = Object.entries(spec.paths) as [string, { get: Op }][]
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader breadcrumb={<Link href="/help" className="tt-nav-link text-sm">← Help</Link>} />
      <Page>
        <PageHeader title="API" description="Free, read-only JSON. No key, no sign-in. Plans, places on the water and public time trials." />

        <Section title="The basics">
          <ul className="list-disc pl-5 space-y-1 text-base text-fg">
            <li>Every endpoint is a plain <code>GET</code> that answers JSON, with CORS open to any site.</li>
            <li>Units are in the field names (<code>distance_km</code>, <code>duration_s</code>). Times are ISO 8601 with an offset. Route lines are GeoJSON (<code>[lng, lat]</code>); everything else is <code>{'{'}lat, lng{'}'}</code>.</li>
            <li>Every response lists its sources in <code>attribution</code>. Show those credits wherever you show the data: OpenStreetMap is ODbL, the navigation authorities&apos; data has its own licences.</li>
            <li>Errors look like <code>{'{'}&quot;error&quot;: {'{'}&quot;code&quot;: &quot;not_connected&quot;, &quot;message&quot;: &quot;…&quot;{'}'}{'}'}</code>.</li>
            <li>The full description, for tools: <a className="tt-link" href="/api/v1/openapi.json">/api/v1/openapi.json</a> (OpenAPI 3.1).</li>
            <li>For planning only. paddlesnitch is not a navigation authority: check closures, river levels and the tide.</li>
          </ul>
        </Section>

        {paths.map(([path, { get }]) => (
          <Section key={path} title={get.summary}>
            <div className={`${cardClass} p-4 flex flex-col gap-3`}>
              <p className="font-mono text-sm text-fg break-all"><span className="text-muted">GET</span> {path}</p>
              {get.description && <p className="text-base text-muted">{get.description}</p>}
              {get.parameters?.length ? (
                <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
                  {get.parameters.map(p => (
                    <div key={p.name} className="contents">
                      <dt className="font-mono text-fg">{p.name}{p.required ? <span className="text-red" title="required"> *</span> : null}</dt>
                      <dd className="text-muted">
                        {p.description ?? (p.in === 'path' ? 'In the path.' : '')}
                        {p.schema?.enum ? ` One of ${p.schema.enum.join(', ')}.` : ''}
                        {p.schema?.default !== undefined ? ` Default ${String(p.schema.default)}.` : ''}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {EXAMPLES[path] && (
                <p className="text-sm"><span className="text-muted">Try: </span><a className="tt-link font-mono break-all" href={EXAMPLES[path]}>{EXAMPLES[path]}</a></p>
              )}
            </div>
          </Section>
        ))}
      </Page>
    </main>
  )
}
