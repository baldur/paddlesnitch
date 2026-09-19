// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildFirmwareEmf, FIRMWARE_NAMESPACE, FIRMWARE_METRICS } from './firmware-metrics'

describe('firmware EMF', () => {
  it('declares Version and Model as the only dimensions — never deviceId', () => {
    const doc = buildFirmwareEmf('FirmwareOfferIssued', { version: '0.10.0', model: 'lilygo-tbeam-s3-supreme' })
    const cw = doc._aws.CloudWatchMetrics[0]
    expect(cw.Namespace).toBe(FIRMWARE_NAMESPACE)
    expect(cw.Dimensions).toEqual([['Version', 'Model']])
    // A deviceId dimension would be unbounded cardinality and would turn the
    // metrics bill into a per-device tracking system. Per-device detail belongs
    // in the firmware-events records, which expire.
    expect(JSON.stringify(cw.Dimensions)).not.toContain('device')
  })

  it('emits the metric under its own name so each is separately chartable', () => {
    for (const m of FIRMWARE_METRICS) {
      const doc = buildFirmwareEmf(m, { version: '0.10.0' })
      expect(doc._aws.CloudWatchMetrics[0].Metrics).toEqual([{ Name: m, Unit: 'Count' }])
      expect((doc as Record<string, unknown>)[m]).toBe(1)
    }
  })

  it('clamps dimension values, because an unexpected one is billed forever', () => {
    const doc = buildFirmwareEmf('FirmwareBootFailed', { version: 'not a version; drop tables', model: null })
    expect(doc.Version).toBe('unknown')
    expect(doc.Model).toBe('unknown')
  })

  it('carries high-cardinality context as plain properties, not dimensions', () => {
    const doc = buildFirmwareEmf('FirmwareBootFailed', { version: '0.10.0' }, { resetReason: 'TG0WDT_SYS_RST', rolledBack: true })
    expect(doc.resetReason).toBe('TG0WDT_SYS_RST')
    expect(doc.rolledBack).toBe(true)
    expect(doc._aws.CloudWatchMetrics[0].Dimensions).toEqual([['Version', 'Model']])
  })
})
