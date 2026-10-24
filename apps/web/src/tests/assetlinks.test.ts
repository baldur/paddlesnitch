// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { GET } from '@/app/.well-known/assetlinks.json/route'
import { proxy } from '@/proxy'
import { NextRequest } from 'next/server'

describe('/.well-known/assetlinks.json', () => {
  it('lets the Android app handle paddlesnitch.com links, for each key it is signed with', async () => {
    const res = GET()
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    const [s] = await res.json()
    expect(s.relation).toEqual(['delegate_permission/common.handle_all_urls'])
    expect(s.target.package_name).toBe('com.paddlesnitch.app')
    expect(s.target.sha256_cert_fingerprints.length).toBeGreaterThan(0)
    for (const f of s.target.sha256_cert_fingerprints) expect(f).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
  })

  it('is public: the sign-in gate never redirects it', () => {
    const res = proxy(new NextRequest('https://paddlesnitch.com/.well-known/assetlinks.json'))
    expect(res.headers.get('location')).toBeNull()
  })
})
