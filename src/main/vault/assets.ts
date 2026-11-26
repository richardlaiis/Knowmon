// The knowmon-asset:// protocol: serves only image files inside the current vault (for images in notes)
import fs from 'node:fs/promises'
import { assetPathFromUrl, imageMime } from '../../shared/assets'
import { resolveInVault } from './paths'

/** Reads an image inside the vault by URL; hidden files, paths escaping the vault and non-images are never served */
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
    // The file may be replaced externally, so don't let the browser reuse its cache
    return new Response(new Uint8Array(data), {
      headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' }
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}
