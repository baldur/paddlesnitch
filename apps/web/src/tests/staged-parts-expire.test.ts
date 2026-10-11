// Pieces of an upload that never completes expire (#412): they're tagged on
// write, and a bucket lifecycle rule with the same tag expires them after a
// window far longer than anyone waits to resume a Bluetooth sync.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { STAGED_PART_TAG, taggingHeader } from '@paddlesnitch/core/storage'

const root = path.join(__dirname, '../../../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

describe('staged upload pieces expire', () => {
  it('the tag is sent the way S3 expects it', () => {
    expect(taggingHeader(STAGED_PART_TAG)).toBe('lifecycle=staged-part')
    expect(taggingHeader({ a: 'b c', d: 'e&f' })).toBe('a=b+c&d=e%26f')
  })

  it('both kinds of piece (track and motion) are written with the tag', () => {
    const src = read('packages/core/src/devices.ts')
    expect(src).toContain('putObject(uploadPartKey(deviceId, filename, part), chunk, { tags: STAGED_PART_TAG })')
    expect(src).toContain('putObject(motionPartKey(deviceId, sessionId, part), chunk, { tags: STAGED_PART_TAG })')
  })

  it('the bucket expires that tag after 30 days, long enough to resume', () => {
    const stack = read('infra/lib/att-stack.ts')
    const rule = stack.slice(stack.indexOf("id: 'expire-staged-upload-parts'"), stack.indexOf("id: 'expire-staged-upload-parts'") + 300)
    const [[k, v]] = Object.entries(STAGED_PART_TAG)
    expect(rule).toContain(`tagFilters: { ${k}: '${v}' }`)
    expect(rule).toContain('expiration: cdk.Duration.days(30)')
  })
})
