// @vitest-environment jsdom
// Boat motion and its technical details, drawn from the answers the apps
// decode too (mobile/contract/fixtures/api/account.devices-session*.json), so
// the website and the contract's README describe the same screen.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { readFileSync } from 'fs'
import path from 'path'
import { createRoot, type Root } from 'react-dom/client'
import BoatMotion from './BoatMotion'
import TechnicalDetails from './TechnicalDetails'
import { describeDeviceData } from '@paddlesnitch/timing/device'
import { trackCsv } from '@/tests/tracker-fixtures'

const fixture = (name: string) => JSON.parse(readFileSync(
  path.join(__dirname, '../../../../../mobile/contract/fixtures/api', `account.devices-session${name}.json`), 'utf8'))

let container: HTMLDivElement
let root: Root
afterEach(async () => { if (root) await act(async () => { root.unmount() }); container?.remove() })
async function render(node: React.ReactNode) {
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(node) })
  return container.textContent ?? ''
}

describe('boat motion', () => {
  it('draws the tiles from a measured recording, evenness by size', async () => {
    const r = fixture('')
    const text = await render(<BoatMotion attitude={r.attitude} strokeRate={60.1} />)
    expect(text).toContain(`${r.attitude.rollRmsDeg}°`)
    expect(text).toContain(`${Math.round(Math.abs(r.attitude.symmetry.imbalancePct))}%`)
    expect(text).toMatch(/Stroke rate60spm/)
  })

  it("keeps the engine's reason out of the paddler's box; it's under Technical details", async () => {
    const r = fixture('.motion-unusable')
    expect(r.attitude.available).toBe(false)
    const box = await render(<BoatMotion attitude={r.attitude} strokeRate={null} />)
    expect(box).toContain('No boat motion for this recording.')
    expect(box).toContain('We couldn’t measure boat motion in this recording.')
    expect(box).not.toContain(r.attitude.reason)
    await act(async () => { root.unmount() }); container.remove()
    const details = await render(<TechnicalDetails report={describeDeviceData(trackCsv(600, 9))} cadence={r.cadence} attitude={r.attitude} />)
    expect(details).toContain(`Boat motion: ${r.attitude.reason}`)
  })

  it("says the motion file hasn't arrived when there is none", async () => {
    const r = fixture('.no-motion')
    expect(await render(<BoatMotion attitude={r.attitude} strokeRate={null} />)).toContain('If this recording is recent, sync the tracker again.')
  })
})
