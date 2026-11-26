// Assembles several PNGs into a macOS .icns (no need for iconutil, so it works on Linux too)
// Format: 'icns' + total length (big-endian uint32), then each chunk is a 4-character type + chunk length (including the 8-byte header) + PNG data
/* eslint-disable @typescript-eslint/explicit-function-return-type */

/** The ICNS type for each size (PNG content) */
export const ICNS_TYPES = { 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' }

/** @param {{ type: string, data: Uint8Array }[]} entries */
export function buildIcns(entries) {
  const chunks = entries.map(({ type, data }) => {
    if (!/^[\x20-\x7e]{4}$/.test(type)) throw new Error(`ICNS type 必須是 4 個 ASCII 字元：${type}`)
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, Buffer.from(data)])
  })
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}
