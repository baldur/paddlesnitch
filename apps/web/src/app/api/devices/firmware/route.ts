import { NextResponse } from 'next/server'
import { withDeviceAuth, reportedFirmware, reportedModel } from '@/lib/device-route'
import { firmwareOfferFor, isFirmwareVersion, recordFirmwareOffered } from '@/lib/firmware'
import { emitFirmwareMetric } from '@/lib/firmware-metrics'

// GET /api/devices/firmware?current=<semver> — device token (Bearer).
// docs/features/device-ota-and-auth.md §1.2.
//
// This is NOT the steady-state path. A device only gets here after the
// `X-PS-Firmware` header on some other response told it a new version exists
// (or, rarely, after its 7-day no-contact fallback probe fired). The common case
// in this handler is therefore still 304 — a device that raced a promotion, or
// re-checked after a failed download.
//
// 304 carries no body by design: it is the cheap answer and must stay one cached
// channel read. The ETag is the version string, so a device that sends
// If-None-Match gets its 304 without us reading a manifest or signing anything.

export const GET = withDeviceAuth(async (req, auth) => {
  const url = new URL(req.url)
  const currentParam = url.searchParams.get('current')
  // Prefer the explicit query param; fall back to the header the uplink already
  // sends on every request, so a probe with neither still behaves sensibly.
  const current = isFirmwareVersion(currentParam) ? currentParam : reportedFirmware(req)
  const model = reportedModel(req)

  const offer = await firmwareOfferFor(current, { origin: url.origin })

  // Nothing promoted yet. Not an error — it is the state of the world until the
  // first release — so say so plainly rather than 404ing a healthy device.
  if (offer.status === 'no_channel') {
    emitFirmwareMetric('FirmwareCheckNotModified', { version: current, model })
    return NextResponse.json({ error: 'no_channel' }, { status: 404 })
  }

  // A channel pointing at a version with no manifest is OUR mistake. Distinguish
  // it from "you are current" so it shows up as a 5xx in the logs instead of
  // hiding as a quiet 304 while no device ever updates.
  if (offer.status === 'missing_manifest') {
    console.error(`[firmware] channel stable -> ${offer.version} but no manifest.json`)
    return NextResponse.json({ error: 'manifest_missing' }, { status: 503 })
  }

  if (offer.status === 'up_to_date') {
    emitFirmwareMetric('FirmwareCheckNotModified', { version: current, model })
    return new Response(null, { status: 304, headers: { ETag: `"${offer.version}"` } })
  }

  const { manifest } = offer
  // Honour a conditional request. The device sends back the ETag it last saw, so
  // a re-check after a failed download costs nothing.
  if (req.headers.get('if-none-match')?.replace(/"/g, '') === manifest.version) {
    emitFirmwareMetric('FirmwareCheckNotModified', { version: current, model })
    return new Response(null, { status: 304, headers: { ETag: `"${manifest.version}"` } })
  }

  // Issuing a 200 is the event worth recording: it is the moment a specific
  // device was handed a specific image. Best-effort — a storage failure here
  // must not deny the device an update it is entitled to.
  try {
    await recordFirmwareOffered(auth.deviceId, manifest.version, {
      at: new Date().toISOString(),
      fromVersion: current,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
    })
  } catch (e) {
    console.error('[firmware] could not record offer', e)
  }
  emitFirmwareMetric('FirmwareOfferIssued', { version: manifest.version, model }, { fromVersion: current ?? 'unknown' })

  return NextResponse.json({
    version: manifest.version,
    sha256: manifest.sha256,
    sizeBytes: manifest.sizeBytes,
    notes: manifest.notes,
    url: offer.url,
    expiresInSeconds: offer.expiresInSeconds,
  }, { status: 200, headers: { ETag: `"${manifest.version}"` } })
})

