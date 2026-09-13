import { describe, it, expect } from 'vitest'
import { weatherUrl, getWeatherAt } from './weather'

const okJson = (body: unknown) =>
  (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch

describe('weatherUrl endpoint choice', () => {
  const now = new Date('2026-07-02T12:00:00Z')
  it('uses the archive API for instants well in the past', () => {
    const url = weatherUrl(51.5, -0.9, new Date('2026-06-20T08:00:00Z'), now)
    expect(url).toContain('archive-api.open-meteo.com')
    expect(url).toContain('start_date=2026-06-20')
    expect(url).toContain('end_date=2026-06-20')
  })
  it('uses the forecast API (past_days) for recent instants', () => {
    const url = weatherUrl(51.5, -0.9, new Date('2026-07-01T08:00:00Z'), now)
    expect(url).toContain('api.open-meteo.com/v1/forecast')
    expect(url).toContain('past_days=')
  })
})

describe('getWeatherAt', () => {
  const hourly = {
    time: ['2026-07-01T07:00', '2026-07-01T08:00', '2026-07-01T09:00'],
    temperature_2m: [12, 14, 16],
    precipitation: [0, 0.4, 0],
    wind_speed_10m: [10, 18, 20],
    wind_direction_10m: [200, 230, 250],
  }

  it('returns the hour nearest the requested time', async () => {
    const r = await getWeatherAt(51.5, -0.9, '2026-07-01T08:10:00Z', okJson({ hourly }))
    expect(r).toEqual({ temperatureC: 14, precipitationMm: 0.4, windSpeedKmh: 18, windDirectionDeg: 230 })
  })

  it('rounds to the closer hour', async () => {
    const r = await getWeatherAt(51.5, -0.9, '2026-07-01T08:40:00Z', okJson({ hourly }))
    expect(r?.temperatureC).toBe(16) // 09:00 is closer than 08:00
  })

  it('returns null on a non-ok response', async () => {
    const bad = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch
    expect(await getWeatherAt(51.5, -0.9, '2026-07-01T08:00:00Z', bad)).toBeNull()
  })

  it('returns null on an empty hourly series', async () => {
    expect(await getWeatherAt(51.5, -0.9, '2026-07-01T08:00:00Z', okJson({ hourly: { time: [] } }))).toBeNull()
  })

  it('returns null (never throws) when fetch throws', async () => {
    const boom = (async () => { throw new Error('network') }) as unknown as typeof fetch
    expect(await getWeatherAt(51.5, -0.9, '2026-07-01T08:00:00Z', boom)).toBeNull()
  })

  it('returns null for an invalid timestamp', async () => {
    expect(await getWeatherAt(51.5, -0.9, 'not-a-date', okJson({ hourly }))).toBeNull()
  })
})
