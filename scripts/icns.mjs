// 把多張 PNG 組成 macOS 的 .icns（不需要 iconutil，Linux 也能產生）
// 格式：'icns' + 總長度（big-endian uint32），接著每個區塊是 4 字元 type + 區塊長度（含 8 bytes 標頭）+ PNG 資料
/* eslint-disable @typescript-eslint/explicit-function-return-type */

/** 各尺寸對應的 ICNS type（PNG 內容） */
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
