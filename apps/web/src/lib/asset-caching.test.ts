// Built files (/_next/static/<hash>…) are kept by the browser for a year:
// their names change whenever their contents do. Only those: a public/ file
// keeps its name across builds, and "keep it for a year" would pin the old one.
// Reads the CDK source, like infra-safety.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const stack = readFileSync(path.resolve(__dirname, '../../../../infra/lib/att-stack.ts'), 'utf8')

describe('browser caching of built files', () => {
  it('marks /_next/static/* as cacheable for a year and unchanging', () => {
    expect(stack).toMatch(/header: 'Cache-Control', value: 'public, max-age=31536000, immutable'/)
    const rule = stack.slice(stack.indexOf("'/_next/static/*': {"), stack.indexOf("'/_next/static/*': {") + 400)
    expect(rule).toContain('responseHeadersPolicy: immutableAssetHeaders')
  })
  it('puts that rule before /_next/* (CloudFront takes the first match)', () => {
    expect(stack.indexOf("'/_next/static/*': {")).toBeGreaterThan(0)
    expect(stack.indexOf("'/_next/static/*': {")).toBeLessThan(stack.indexOf("'/_next/*': {"))
  })
  it('gives the year-long header to nothing else', () => {
    expect(stack.match(/responseHeadersPolicy: immutableAssetHeaders/g)?.length).toBe(1)
  })
})
