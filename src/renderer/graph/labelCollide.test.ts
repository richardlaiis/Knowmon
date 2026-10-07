import { forceSimulation } from 'd3-force'
import { describe, expect, it } from 'vitest'
import { ForceLayout } from './forceLayout'
import {
  LABEL_FONT_SIZE,
  estimateLabelWidth,
  footprint,
  forceRectCollide,
  type RectNode
} from './labelCollide'

describe('estimateLabelWidth', () => {
  it('中日韓文字約一個字寬，英數約 0.6 個字寬', () => {
    expect(estimateLabelWidth('原子習慣', 10)).toBe(40)
    expect(estimateLabelWidth('abcde', 10)).toBe(31)
    expect(estimateLabelWidth('Knowmon 開發日誌', 10)).toBe(Math.ceil((7 * 0.62 + 0.3 + 4) * 10))
    expect(estimateLabelWidth('')).toBe(0)
  })

  it('預設使用圖譜標籤的字級', () => {
    expect(estimateLabelWidth('字')).toBe(LABEL_FONT_SIZE)
  })
})

describe('footprint', () => {
  it('寬度取節點與標籤較寬者，下方包含標籤', () => {
    const f = footprint(5, 100)
    expect(f.half).toBeGreaterThanOrEqual(50)
    expect(f.top).toBeLessThan(f.bottom)
    expect(footprint(30, 10).half).toBeGreaterThanOrEqual(30)
  })

  it('沒有標籤時是節點的方框', () => {
    const f = footprint(5, 0)
    expect(f.top).toBe(f.bottom)
    expect(f.half).toBe(f.top)
  })
})

type Box = { x1: number; x2: number; y1: number; y2: number }
function boxes(nodes: RectNode[]): Box[] {
  return nodes.map((n) => ({
    x1: n.x! - n.box.half,
    x2: n.x! + n.box.half,
    y1: n.y! - n.box.top,
    y2: n.y! + n.box.bottom
  }))
}
function overlaps(bs: Box[], slack = 0): number {
  let count = 0
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i]
      const b = bs[j]
      if (
        Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > slack &&
        Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > slack
      ) {
        count++
      }
    }
  }
  return count
}

describe('forceRectCollide', () => {
  it('把疊在一起的寬標籤推開', () => {
    const nodes: RectNode[] = [
      { x: 0, y: 0, box: footprint(5, 120) },
      { x: 10, y: 5, box: footprint(5, 120) },
      { x: 0, y: 0, box: footprint(5, 80) }
    ]
    forceSimulation(nodes).force('collide', forceRectCollide()).stop().tick(100)
    expect(overlaps(boxes(nodes))).toBe(0)
  })

  it('不重疊的節點不受影響', () => {
    const nodes: RectNode[] = [
      { x: 0, y: 0, box: footprint(5, 40) },
      { x: 200, y: 0, box: footprint(5, 40) }
    ]
    forceSimulation(nodes).force('collide', forceRectCollide()).stop().tick(10)
    expect(nodes.map((n) => [Math.round(n.x!), Math.round(n.y!)])).toEqual([
      [0, 0],
      [200, 0]
    ])
  })
})

describe('ForceLayout 連同標籤', () => {
  it('收斂後標籤不重疊', () => {
    let seed = 7
    const random = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const n = 300
    const titles = Array.from({ length: n }, (_, i) =>
      i % 3 === 0 ? `2025-0${(i % 9) + 1}-1${i % 9}` : `主題 筆記 ${i}`
    )
    const layout = new ForceLayout(
      titles.map((t, i) => ({
        id: `n${i}`,
        x: (random() - 0.5) * 300,
        y: (random() - 0.5) * 300,
        r: 5,
        labelWidth: estimateLabelWidth(t)
      })),
      Array.from({ length: n - 1 }, (_, i) => ({
        source: `n${i + 1}`,
        target: `n${Math.floor(random() * (i + 1))}`
      }))
    )
    while (!layout.done) layout.tick(10)
    // 收斂時會做一次只有碰撞的整理（容許 1px 內的浮點殘差）
    const pos = layout.positions()
    const bs = titles.map((t, i) => {
      const f = footprint(5, estimateLabelWidth(t))
      return {
        x1: pos[i * 2] - f.half,
        x2: pos[i * 2] + f.half,
        y1: pos[i * 2 + 1] - f.top,
        y2: pos[i * 2 + 1] + f.bottom
      }
    })
    expect(overlaps(bs, 1)).toBe(0)
  })
})
