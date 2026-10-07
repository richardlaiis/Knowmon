import { describe, expect, it } from 'vitest'
import { ALPHA_MIN, ForceLayout, type LayoutEdgeInput, type LayoutNodeInput } from './forceLayout'

function randomGraph(n: number): { nodes: LayoutNodeInput[]; edges: LayoutEdgeInput[] } {
  let seed = 42
  const random = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    x: (random() - 0.5) * 1000,
    y: (random() - 0.5) * 1000,
    r: 5
  }))
  const edges: LayoutEdgeInput[] = []
  for (let i = 1; i < n; i++) {
    for (let k = 0; k < 2; k++)
      edges.push({ source: `n${i}`, target: `n${Math.floor(random() * i)}` })
  }
  return { nodes, edges }
}

const dist = (p: Float32Array, i: number, j: number): number =>
  Math.hypot(p[i * 2] - p[j * 2], p[i * 2 + 1] - p[j * 2 + 1])

describe('ForceLayout', () => {
  it('相連的節點會靠近，不相連的會分開', () => {
    const layout = new ForceLayout(
      [
        { id: 'a', x: -300, y: 0, r: 5 },
        { id: 'b', x: 300, y: 0, r: 5 },
        { id: 'c', x: 0, y: 1, r: 5 }
      ],
      [{ source: 'a', target: 'b' }]
    )
    layout.tick(300)
    const p = layout.positions()
    expect(dist(p, 0, 1)).toBeLessThan(100)
    expect(dist(p, 0, 2)).toBeGreaterThan(dist(p, 0, 1))
    expect(layout.done).toBe(true)
  })

  it('positions 依 ids 順序輸出', () => {
    const layout = new ForceLayout([{ id: 'x', x: 1, y: 2, r: 5 }], [])
    expect(layout.ids).toEqual(['x'])
    expect([...layout.positions()]).toEqual([1, 2])
  })

  it('忽略指向不存在節點的邊', () => {
    expect(
      () => new ForceLayout([{ id: 'a', x: 0, y: 0, r: 5 }], [{ source: 'a', target: '不存在' }])
    ).not.toThrow()
  })

  it('pin 固定節點並重新加熱，unpin 後恢復自由', () => {
    const layout = new ForceLayout(
      [
        { id: 'a', x: 0, y: 0, r: 5 },
        { id: 'b', x: 50, y: 0, r: 5 }
      ],
      [{ source: 'a', target: 'b' }],
      0
    )
    expect(layout.done).toBe(true)
    layout.pin('a', 500, 500)
    expect(layout.alpha).toBeGreaterThan(ALPHA_MIN)
    layout.tick(50)
    const p = layout.positions()
    expect([p[0], p[1]]).toEqual([500, 500])
    expect(dist(p, 0, 1)).toBeLessThan(150)
    layout.unpin('a')
    layout.tick(50)
    expect(layout.positions()[0]).not.toBe(500)
  })

  it('tickFor 在時間預算內停止，至少算一步', () => {
    const { nodes, edges } = randomGraph(50)
    const layout = new ForceLayout(nodes, edges)
    let t = 0
    expect(layout.tickFor(10, () => (t += 4))).toBe(3)
    expect(layout.tickFor(0, () => 0)).toBe(1)
  })

  it('1000 節點、2000 條邊在幾秒內收斂', () => {
    const { nodes, edges } = randomGraph(1000)
    const layout = new ForceLayout(nodes, edges)
    const start = performance.now()
    let ticks = 0
    while (!layout.done) ticks += layout.tickFor(50)
    const ms = performance.now() - start
    // 寬鬆的上限，避免機器差異造成誤判；實測約 1–2 秒
    expect(ms).toBeLessThan(8000)
    expect(ticks).toBeLessThan(400)
    expect([...layout.positions()].every(Number.isFinite)).toBe(true)
  }, 15_000)
})
