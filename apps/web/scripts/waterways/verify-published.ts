#!/usr/bin/env node
// Check a published waterways version the way the server will see it, before
// it goes live: read it back from storage with the server's own loader
// (readDataset), route every check route against it, and measure the memory
// that took. The weekly refresh runs this after --publish and only makes the
// version live if it passes.
//
//   pnpm --filter web waterways:verify [--version <v>]   (default: manifest.json's)
//
// See docs/features/waterways-uk-ireland.md (Pipeline, **refresh**).
import { getObject } from '@paddlesnitch/core/storage'
import { checkRoutes } from '@paddlesnitch/waterways/checks'
import { manifest, readDataset } from '@paddlesnitch/waterways/national'

/** The server Lambda has 2048 MB (infra/lib/att-stack.ts), and Next itself
 *  needs room beside the dataset. A version whose loaded dataset alone peaks
 *  above this would run the Lambda out of memory. */
const MAX_RSS_MB = 1700

async function main() {
  const i = process.argv.indexOf('--version')
  const version = i >= 0 ? process.argv[i + 1] : manifest.version
  if (!version) throw new Error('no version to verify')
  const t0 = Date.now()
  const ds = await readDataset(getObject, version)
  if (!ds) throw new Error(`version ${version} has no network in storage`)
  console.log(`loaded ${version}: ${ds.links.length} links, ${ds.features.length} features, ${ds.places.length} places (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
  const failed = checkRoutes(ds.links, ds.features)
  // maxRSS is in kilobytes.
  const rssMb = Math.round(process.resourceUsage().maxRSS / 1024)
  console.log(`peak memory: ${rssMb} MB (limit ${MAX_RSS_MB} MB)`)
  const problems = [
    failed ? `${failed} check route(s) failed` : '',
    rssMb > MAX_RSS_MB ? `peak memory ${rssMb} MB is over ${MAX_RSS_MB} MB` : '',
    !ds.places.length ? 'no places' : '',
  ].filter(Boolean)
  if (problems.length) throw new Error(`version ${version} is not fit to go live: ${problems.join('; ')}`)
  console.log(`\n${version} is fit to go live.`)
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
