// knowmon-asset:// 協定：只提供目前 vault 內的圖片檔（筆記中的圖片用）
import fs from 'node:fs/promises'
import { assetPathFromUrl, imageMime } from '../../shared/assets'
import { resolveInVault } from './paths'

/** 依網址讀取 vault 內的圖片；隱藏檔、跳出 vault、不是圖片都不提供 */
export async function assetResponse(root: string | null, url: string): Promise<Response> {
  const rel = assetPathFromUrl(url)
  const mime = rel ? imageMime(rel) : null
  if (!root || !rel || !mime) return new Response(null, { status: 404 })
  let abs: string
  try {
    abs = resolveInVault(root, rel)
  } catch {
    return new Response(null, { status: 403 })
  }
  try {
    const data = await fs.readFile(abs)
    // 檔案可能在外部被替換，不讓瀏覽器沿用快取
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' }
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}
