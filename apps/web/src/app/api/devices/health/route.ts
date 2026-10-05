import { NextResponse } from 'next/server'
import { withDeviceAuth, reportedFirmware, reportedModel } from '@/lib/device-route'
import { sanitizeHealth, storeDeviceHealth } from '@/lib/devices'
import { emitFirmwareMetric } from '@/lib/firmware-metrics'

// POST /api/devices/health — the tracker's own token. Once per start: why it
// restarted, with the chip's crash summary if it crashed; and hourly while on
// WiFi, a heartbeat (uptime, lowest free memory, battery, stack headroom). A
// crash is counted per version and model (DeviceCrash) so a bad release shows
// on the firmware dashboard before anyone reports it; the device id, task and
// address go in the log line as properties, never as metric dimensions.
// See docs/features/release-testing.md.
export const POST = withDeviceAuth(async (req, auth) => {
  const h = sanitizeHealth(await req.json().catch(() => null), reportedFirmware(req))
  if (!h) return NextResponse.json({ error: 'bad_report' }, { status: 400 })
  await storeDeviceHealth(auth.deviceId, h)
  if (h.crash) {
    emitFirmwareMetric('DeviceCrash', { version: h.firmware, model: reportedModel(req) }, {
      deviceId: auth.deviceId, resetReason: h.resetReason ?? '', task: h.crash.task, pc: h.crash.pc,
      bt: h.crash.bt.join(' '), elf: h.crash.elf,
    })
  }
  return NextResponse.json({ ok: true })
})
