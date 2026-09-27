// CloudWatch EMF for firmware rollout (docs/features/device-ota-and-auth.md §2.1).
//
// Deliberately NOT folded into @/lib/metrics. That module is product analytics:
// one namespace, one dimension (`Event`), a client-facing allowlist, and a
// public ingest endpoint feeding it. This is operational telemetry about a fleet
// — different namespace, different dimensions, and nothing outside the server
// can emit it. Sharing the builder would mean either giving the product metric
// arbitrary dimensions or giving this one a client ingest path; neither is
// something we want.
//
// **Cardinality: `Version` and `Model` only. Never `deviceId`.** A per-device
// dimension is unbounded, and it would quietly turn a metrics bill into a
// per-device tracking system. Per-device detail lives in the firmware-events
// records behind the admin route, which expire after 90 days.

export const FIRMWARE_NAMESPACE = 'Paddlesnitch/Firmware'

export type FirmwareMetric =
  | 'FirmwareOfferIssued'
  | 'FirmwareCheckNotModified'
  | 'FirmwareBootConfirmed'
  | 'FirmwareBootFailed'

export const FIRMWARE_METRICS: readonly FirmwareMetric[] = [
  'FirmwareOfferIssued', 'FirmwareCheckNotModified', 'FirmwareBootConfirmed', 'FirmwareBootFailed',
]

// A dimension VALUE is part of the metric's identity in CloudWatch, so an
// unexpected one creates a new metric that is then billed forever. Clamp both.
const DIM = /^[\w.-]{1,40}$/
const safeDim = (v: string | null | undefined, fallback: string) =>
  v && DIM.test(v) ? v : fallback

/** Build the EMF document (exported for testing). */
export function buildFirmwareEmf(
  metric: FirmwareMetric,
  dims: { version?: string | null; model?: string | null },
  props: Record<string, string | number | boolean> = {},
  timestamp: number = Date.now(),
) {
  return {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [{
        Namespace: FIRMWARE_NAMESPACE,
        Dimensions: [['Version', 'Model']],
        Metrics: [{ Name: metric, Unit: 'Count' }],
      }],
    },
    Version: safeDim(dims.version, 'unknown'),
    Model: safeDim(dims.model, 'unknown'),
    [metric]: 1,
    ...props,
  }
}

/** Emit one firmware metric. Never throws — telemetry must not break a device
 *  sync, which is the request these ride on. */
export function emitFirmwareMetric(
  metric: FirmwareMetric,
  dims: { version?: string | null; model?: string | null },
  props: Record<string, string | number | boolean> = {},
): void {
  try {
    console.log(JSON.stringify(buildFirmwareEmf(metric, dims, props)))
  } catch {
    // swallow
  }
}
