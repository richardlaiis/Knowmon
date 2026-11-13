import { describe, expect, it } from 'vitest'
import { ICNS_TYPES, buildIcns } from './icns.mjs'

describe('buildIcns', () => {
  it('writes the icns header and one block per entry', () => {
    const a = Uint8Array.from([1, 2, 3])
    const b = Uint8Array.from([4, 5])
    const out = buildIcns([
      { type: 'ic07', data: a },
      { type: 'ic10', data: b }
    ])
    expect(out.toString('ascii', 0, 4)).toBe('icns')
    expect(out.readUInt32BE(4)).toBe(out.length)
    expect(out.length).toBe(8 + 8 + 3 + 8 + 2)
    expect(out.toString('ascii', 8, 12)).toBe('ic07')
    expect(out.readUInt32BE(12)).toBe(11)
    expect([...out.subarray(16, 19)]).toEqual([1, 2, 3])
    expect(out.toString('ascii', 19, 23)).toBe('ic10')
    expect(out.readUInt32BE(23)).toBe(10)
    expect([...out.subarray(27)]).toEqual([4, 5])
  })

  it('rejects malformed types', () => {
    expect(() => buildIcns([{ type: 'ic1', data: new Uint8Array() }])).toThrow()
  })

  it('maps the PNG sizes macOS expects', () => {
    expect(ICNS_TYPES).toEqual({ 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' })
  })
})
