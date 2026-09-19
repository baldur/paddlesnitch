import { NextResponse } from 'next/server'
import { withDeviceAuth, reportedModel } from '@/lib/device-route'
import { isFirmwareVersion, recordFirmwareBooted } from '@/lib/firmware'
import { emitFirmwareMetric } from '@/lib/firmware-metrics'

// POST /api/devices/firmware/ack — device token (Bearer).
// docs/features/device-ota-and-auth.md §1.5.
//
// The device reports how the first boot on a new image went. This is the only
// way the server learns an update actually WORKED — a download completing tells
// us nothing about whether the thing boots, and a device that rolled itself back
// is exactly the case that must reach the dashboard.
//
// Idempotent on (deviceId, version), because the ack rides on a sync and a sync
// can fail: a device that retries must not double-count a boot failure and make
// a healthy rollout look like a broken one.
//
// { version, previousVersion, bootOk, resetReason, rolledBack } -> 204

export const POST = withDeviceAuth(async (req, auth) => {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'bad_json' }, { status: 400 })

  const version = body.version
  if (!isFirmwareVersion(version)) return NextResponse.json({ error: 'bad_version' }, { status: 400 })

  const previousVersion = isFirmwareVersion(body.previousVersion) ? body.previousVersion : null
  const rolledBack = body.rolledBack === true
  // A rollback is never a successful boot, whatever the device claims — the two
  // fields are independent on the wire and a firmware bug could set both.
  const bootOk = body.bootOk === true && !rolledBack
  const resetReason = typeof body.resetReason === 'string' ? body.resetReason.slice(0, 40) : undefined

  const result = await recordFirmwareBooted(auth.deviceId, version, {
    at: new Date().toISOString(),
    fromVersion: previousVersion,
    bootOk,
    rolledBack,
    resetReason,
  })

  // Only the first ack counts. A retry is still a 204 — the device has done its
  // job and must not be told to try again.
  if (result === 'recorded') {
    emitFirmwareMetric(
      bootOk ? 'FirmwareBootConfirmed' : 'FirmwareBootFailed',
      { version, model: reportedModel(req) },
      { fromVersion: previousVersion ?? 'unknown', rolledBack, resetReason: resetReason ?? 'unknown' },
    )
  }

  return new Response(null, { status: 204 })
})
