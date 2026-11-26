// Generates the app icons for each platform from build/icon.svg (needs the system ImageMagick 7: the magick command)
// Usage: node scripts/gen-icons.mjs
// Output: build/icon.png (1024), build/icon.ico, build/icon.icns, resources/icon.png (512, the Linux window icon)
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ICNS_TYPES, buildIcns } from './icns.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svg = path.join(root, 'build/icon.svg')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'knowmon-icons-'))

/** Rasterize the SVG at high density and then scale down, for smoother edges */
const render = (size, out) => {
  execFileSync('magick', [
    '-background',
    'none',
    '-density',
    String(Math.ceil((size / 512) * 96 * 2)),
    svg,
    '-resize',
    `${size}x${size}`,
    `PNG32:${out}`
  ])
  return out
}

try {
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
  const png = Object.fromEntries(sizes.map((s) => [s, render(s, path.join(tmp, `${s}.png`))]))

  fs.copyFileSync(png[1024], path.join(root, 'build/icon.png'))
  fs.copyFileSync(png[512], path.join(root, 'resources/icon.png'))
  execFileSync('magick', [
    ...[16, 24, 32, 48, 64, 128, 256].map((s) => png[s]),
    path.join(root, 'build/icon.ico')
  ])
  const icns = buildIcns(
    Object.entries(ICNS_TYPES).map(([size, type]) => ({ type, data: fs.readFileSync(png[size]) }))
  )
  fs.writeFileSync(path.join(root, 'build/icon.icns'), icns)
  console.log('已更新 build/icon.png、build/icon.ico、build/icon.icns、resources/icon.png')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
