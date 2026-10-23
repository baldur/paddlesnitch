// One JSON value per line, gzipped, read as a stream. The network is ~120 MB
// of JSON with Germany; parsed as one string, the server's memory peaks near
// 1 GB (the string, its buffer and the parse) and stays there. Read a line at
// a time, the peak is the parsed links plus one chunk (~0.35 GB).
import { createGunzip } from 'zlib'
import { Readable } from 'stream'

export function toNdjson(items: unknown[]): Buffer {
  return Buffer.from(items.map(x => JSON.stringify(x)).join('\n'))
}

export async function readNdjsonGz<T>(gz: Buffer): Promise<T[]> {
  const out: T[] = []
  let rest = ''
  for await (const chunk of Readable.from([gz]).pipe(createGunzip({ chunkSize: 1 << 20 }))) {
    const lines = (rest + (chunk as Buffer).toString('utf8')).split('\n')
    rest = lines.pop()!
    for (const line of lines) if (line) out.push(JSON.parse(line) as T)
  }
  if (rest) out.push(JSON.parse(rest) as T)
  return out
}
