// A minimal dBASE (.dbf) reader: the attribute table of a shapefile. Enough
// for Scottish Canals' downloads, whose tables carry eastings and northings,
// so the geometry (.shp) isn't needed.
export function readDbf(buf: Uint8Array): Record<string, string>[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const count = v.getUint32(4, true), headerLen = v.getUint16(8, true), recordLen = v.getUint16(10, true)
  const latin1 = new TextDecoder('latin1')
  const fields: { name: string; len: number }[] = []
  for (let i = 32; buf[i] !== 0x0d && i < headerLen; i += 32) {
    const raw = buf.subarray(i, i + 11)
    const end = raw.indexOf(0)
    fields.push({ name: latin1.decode(end >= 0 ? raw.subarray(0, end) : raw), len: buf[i + 16] })
  }
  const rows: Record<string, string>[] = []
  for (let r = 0; r < count; r++) {
    const at = headerLen + r * recordLen
    if (buf[at] === 0x2a) continue   // '*': a deleted record
    let o = at + 1
    const row: Record<string, string> = {}
    for (const f of fields) {
      row[f.name] = latin1.decode(buf.subarray(o, o + f.len)).trim()
      o += f.len
    }
    rows.push(row)
  }
  return rows
}
