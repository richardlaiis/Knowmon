import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assetUrl } from '../../shared/assets'
import { assetResponse } from './assets'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-assets-'))
  fs.mkdirSync(path.join(root, 'attachments'))
  fs.mkdirSync(path.join(root, '.knowmon'))
  fs.writeFileSync(path.join(root, 'attachments', '圖 1.png'), Buffer.from([1, 2, 3]))
  fs.writeFileSync(path.join(root, '.knowmon', 'x.png'), Buffer.from([9]))
  fs.writeFileSync(path.join(root, 'note.md'), '# note')
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('assetResponse', () => {
  it('serves images inside the vault with their MIME type', async () => {
    const res = await assetResponse(root, assetUrl('attachments/圖 1.png'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3])
  })

  it('returns 404 when missing, not an image, or no vault is open', async () => {
    expect((await assetResponse(root, assetUrl('attachments/none.png'))).status).toBe(404)
    expect((await assetResponse(root, assetUrl('note.md'))).status).toBe(404)
    expect((await assetResponse(null, assetUrl('attachments/圖 1.png'))).status).toBe(404)
    expect((await assetResponse(root, 'https://vault/x.png')).status).toBe(404)
  })

  it('rejects hidden folders and paths that escape the vault', async () => {
    expect((await assetResponse(root, assetUrl('.knowmon/x.png'))).status).toBe(403)
    expect((await assetResponse(root, 'knowmon-asset://vault/..%2F..%2Fx.png')).status).toBe(403)
    expect((await assetResponse(root, 'knowmon-asset://vault/a/../../x.png')).status).toBe(403)
  })
})
