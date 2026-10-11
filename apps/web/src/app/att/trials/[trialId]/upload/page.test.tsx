// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/att/trials/t1/upload',
}))
vi.mock('@/components/AppHeader', () => ({ default: () => <header /> }))
vi.mock('@/components/map/CourseMapClient', () => ({ default: () => null }))

import UploadPage from './page'

let container: HTMLDivElement
let root: Root
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  vi.unstubAllGlobals()
})

async function mount() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/att/api/auth/me') return new Response(JSON.stringify({ id: 'u1', email: 'a@example.com', displayName: 'Ann' }))
    if (url.includes('/can-submit')) return new Response(JSON.stringify({ canSubmit: true }))
    return new Response('{}', { status: 404 })
  }))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const params = Promise.resolve({ trialId: 't1' })
  await act(async () => { root.render(<UploadPage params={params} />) })
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}

const crewNames = () =>
  [...container.querySelectorAll<HTMLInputElement>('input[placeholder="Crew member name"], input[placeholder="Cox name"]')].map(i => i.value)

async function pickBoat(value: string) {
  const select = container.querySelector('select') as HTMLSelectElement
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('upload page crew list', () => {
  it('lays out one name per seat for the boat class, with the bow pre-filled with your name', async () => {
    await mount()
    expect(crewNames()).toEqual([])
    await pickBoat('K2')
    expect(crewNames()).toEqual(['Ann', ''])
    await pickBoat('4+')
    expect(crewNames()).toEqual(['Ann', '', '', '', ''])
    await pickBoat('')
    expect(crewNames()).toEqual([])
  })
})
