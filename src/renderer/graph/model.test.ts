import { describe, expect, it } from 'vitest'
import type { GraphData } from '../../shared/types'
import {
  adjacency,
  diffGraph,
  edgeId,
  localSubgraph,
  neighborhood,
  nodeRadius,
  seedPositions
} from './model'

const node = (path: string): GraphData['nodes'][number] => ({
  path,
  title: path.replace(/\.md$/, ''),
  eventDate: null
})
const edge = (source: string, target: string, weight = 1): GraphData['edges'][number] => ({
  source,
  target,
  type: 'wikilink',
  weight
})

// a → b → c → d，e → b，f 孤立
const data: GraphData = {
  nodes: ['a', 'b', 'c', 'd', 'e', 'f'].map((p) => node(p + '.md')),
  edges: [edge('a.md', 'b.md'), edge('b.md', 'c.md'), edge('c.md', 'd.md'), edge('e.md', 'b.md')]
}
const paths = (g: GraphData): string[] => g.nodes.map((n) => n.path)

describe('adjacency / neighborhood', () => {
  it('不分方向，孤立筆記也有空集合', () => {
    const adj = adjacency(data)
    expect([...adj.get('b.md')!].sort()).toEqual(['a.md', 'c.md', 'e.md'])
    expect(adj.get('f.md')!.size).toBe(0)
    expect([...neighborhood(adj, 'a.md')].sort()).toEqual(['a.md', 'b.md'])
    expect([...neighborhood(adj, '不存在.md')]).toEqual(['不存在.md'])
  })
})

describe('localSubgraph', () => {
  it('依深度擴展，兩個方向的連結都算', () => {
    expect(paths(localSubgraph(data, 'a.md', 0))).toEqual(['a.md'])
    expect(paths(localSubgraph(data, 'a.md', 1))).toEqual(['a.md', 'b.md'])
    expect(paths(localSubgraph(data, 'a.md', 2))).toEqual(['a.md', 'b.md', 'c.md', 'e.md'])
    expect(paths(localSubgraph(data, 'a.md', 5))).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md'])
  })

  it('只保留子圖內的邊', () => {
    expect(localSubgraph(data, 'd.md', 1).edges).toEqual([edge('c.md', 'd.md')])
  })

  it('孤立或不存在的筆記', () => {
    expect(localSubgraph(data, 'f.md', 3)).toEqual({ nodes: [node('f.md')], edges: [] })
    expect(localSubgraph(data, '不存在.md', 2)).toEqual({ nodes: [], edges: [] })
  })
})

describe('nodeRadius', () => {
  it('隨連結數增加但有上限', () => {
    expect(nodeRadius(0)).toBe(4)
    expect(nodeRadius(4)).toBeGreaterThan(nodeRadius(1))
    expect(nodeRadius(10_000)).toBe(18)
  })
})

describe('seedPositions', () => {
  const random = (): number => 0.5

  it('已知座標沿用，新節點放在已知鄰居附近', () => {
    const known = new Map([
      ['a.md', { x: 100, y: 100 }],
      ['c.md', { x: 300, y: 100 }]
    ])
    const pos = seedPositions(data, known, random)
    expect(pos.get('a.md')).toEqual({ x: 100, y: 100 })
    // b 的鄰居 a、c 都有座標：取平均（jitter 在 random = 0.5 時為 0）
    expect(pos.get('b.md')).toEqual({ x: 200, y: 100 })
    // d 的鄰居 c 有座標
    expect(pos.get('d.md')).toEqual({ x: 300, y: 100 })
    expect(pos.size).toBe(data.nodes.length)
  })

  it('完全沒有已知座標時也會給每個節點座標', () => {
    const pos = seedPositions(data, new Map())
    expect(pos.size).toBe(data.nodes.length)
    for (const p of pos.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    }
  })

  it('不修改傳入的已知座標', () => {
    const known = new Map([['a.md', { x: 1, y: 2 }]])
    seedPositions(data, known).get('a.md')!.x = 99
    expect(known.get('a.md')).toEqual({ x: 1, y: 2 })
  })
})

describe('diffGraph', () => {
  it('找出新增、刪除與變動的節點和邊', () => {
    const next: GraphData = {
      nodes: [
        node('a.md'),
        { ...node('b.md'), eventDate: '2026-10-07' },
        node('c.md'),
        node('d.md'),
        node('e.md'),
        node('g.md')
      ],
      edges: [
        edge('a.md', 'b.md', 3),
        edge('b.md', 'c.md'),
        edge('c.md', 'd.md'),
        edge('g.md', 'a.md')
      ]
    }
    expect(diffGraph(data, next)).toEqual({
      addNodes: ['g.md'],
      removeNodes: ['f.md'],
      updateNodes: ['b.md'],
      addEdges: [edge('g.md', 'a.md')],
      removeEdges: [edgeId(edge('e.md', 'b.md'))],
      updateEdges: [edge('a.md', 'b.md', 3)]
    })
  })

  it('沒有變化時全部為空', () => {
    const d = diffGraph(data, data)
    expect(Object.values(d).every((list) => list.length === 0)).toBe(true)
  })
})
