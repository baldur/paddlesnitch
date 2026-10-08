// Getting a trace file to the server. A request to it can be at most ~4.6 MB
// (AWS's limit for a Lambda request, after the upload is base64-encoded):
// a bigger file was refused before our code ran, and the page said "please try
// again", which never works. Text traces (GPX, TCX, CSV) shrink about ten
// times when gzipped, so a big one is compressed in the browser first and the
// server unpacks it (.gz in parseTrace). Client-safe.

/** What one upload may weigh, with room for the form around the file. */
export const MAX_UPLOAD_BYTES = 4_400_000
/** Smaller files go as they are. */
const COMPRESS_FROM_BYTES = 1_000_000

export const TOO_BIG_MESSAGE =
  'That file is too big to upload. Export the activity as FIT, which is much smaller, or as a Garmin .zip.'

export class TraceTooBig extends Error {
  constructor() { super(TOO_BIG_MESSAGE) }
}

/** The file to send: gzipped when that helps; throws TraceTooBig if it can't fit. */
export async function prepareTraceUpload(file: File): Promise<File> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  // FIT and zip are already compact; gzip gains little on them.
  const compressible = ['gpx', 'tcx', 'csv'].includes(ext)
  let out = file
  if (compressible && file.size >= COMPRESS_FROM_BYTES && typeof CompressionStream !== 'undefined') {
    const gz = await new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob()
    out = new File([gz], `${file.name}.gz`, { type: 'application/gzip' })
  }
  if (out.size > MAX_UPLOAD_BYTES) throw new TraceTooBig()
  return out
}

/** An error message for a failed upload response, with the size case named. */
export function uploadErrorMessage(status: number, body: unknown, fallback: string): string {
  if (status === 413) return TOO_BIG_MESSAGE
  const error = (body as { error?: unknown } | null)?.error
  return typeof error === 'string' ? error : fallback
}
