import { withDeviceAuth } from '@/lib/device-route'
import { handleSessionUpload } from '@/lib/session-upload'

// POST /api/devices/sessions — the tracker uploading with its own token. The
// handling lives in lib/session-upload.ts, shared with the owner's Bluetooth
// relay route.
//
// Wrapped in withDeviceAuth rather than calling getDeviceAuth inline: besides
// the 401, the wrapper stamps `X-PS-Firmware` on every response this returns.
// That header IS the OTA signal — the device learns a new version exists from a
// sync it was making anyway — and the handler returns from fourteen different
// places, which is far too many to remember a header in.
export const POST = withDeviceAuth(handleSessionUpload)
