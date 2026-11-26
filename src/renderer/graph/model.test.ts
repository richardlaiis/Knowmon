import { describe, expect, it } from 'vitest'
import type { GraphData } from '../../shared/types'
import {
  adjacency,
  diffGraph,
  edgeId,
  filterEdges,
  localSubgraph,
  neighborhood,
  nodeRadius,
  seedPositions
} from './model'

const node = (path: string): GraphData['nodes'][number] => ({
  path,
  title: path.replace(/\.md$/, ''),
  eventDate: null,
  activeDays: []
})
const edge = (source: string, target: string, weight = 1): GraphData['edges'][number] => ({
  source,
  target,
  type: 'wikilink',
  weight
})

// a → b → c → d, e → b, f isolated
const data: GraphData = {
  nodes: ['a', 'b', 'c', 'd', 'e', 'f'].map((p) => node(p + '.md')),
  edges: [edge('a.md', 'b.md'), edge('b.md', 'c.md'), edge('c.md', 'd.md'), edge('e.md', 'b.md')]
}
const paths = (g: GraphData): string[] => g.nodes.map((n) => n.path)

describe('adjacency / neighborhood', () => {
  it('undirected, with an empty set for isolated notes', () => {
    const adj = adjacency(data)
    expect([...adj.get('b.md')!].sort()).toEqual(['a.md', 'c.md', 'e.md'])
    expect(adj.get('f.md')!.size).toBe(0)
    expect([...neighborhood(adj, 'a.md')].sort()).toEqual(['a.md', 'b.md'])
    expect([...neighborhood(adj, 'missing.md')]).toEqual(['missing.md'])
  })
})

describe('localSubgraph', () => {
  it('expands by depth, following links in both directions', () => {
    expect(paths(localSubgraph(data, 'a.md', 0))).toEqual(['a.md'])
    expect(paths(localSubgraph(data, 'a.md', 1))).toEqual(['a.md', 'b.md'])
    expect(paths(localSubgraph(data, 'a.md', 2))).toEqual(['a.md', 'b.md', 'c.md', 'e.md'])
    expect(paths(localSubgraph(data, 'a.md', 5))).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md'])
  })

  it('keeps only edges within the subgraph', () => {
    expect(localSubgraph(data, 'd.md', 1).edges).toEqual([edge('c.md', 'd.md')])
  })

  it('isolated or missing notes', () => {
    expect(localSubgraph(data, 'f.md', 3)).toEqual({ nodes: [node('f.md')], edges: [] })
    expect(localSubgraph(data, 'missing.md', 2)).toEqual({ nodes: [], edges: [] })
  })
})

describe('nodeRadius', () => {
  it('grows with link count up to a limit', () => {
    expect(nodeRadius(0)).toBe(4)
    expect(nodeRadius(4)).toBeGreaterThan(nodeRadius(1))
    expect(nodeRadius(10_000)).toBe(18)
  })
})

describe('seedPositions', () => {
  const random = (): number => 0.5

  it('keeps known positions and places new nodes near known neighbors', () => {
    const known = new Map([
      ['a.md', { x: 100, y: 100 }],
      ['c.md', { x: 300, y: 100 }]
    ])
    const pos = seedPositions(data, known, random)
    expect(pos.get('a.md')).toEqual({ x: 100, y: 100 })
    // b's neighbors a and c both have positions: take the average (jitter is 0 when random = 0.5)
    expect(pos.get('b.md')).toEqual({ x: 200, y: 100 })
    // d's neighbor c has a position
    expect(pos.get('d.md')).toEqual({ x: 300, y: 100 })
    expect(pos.size).toBe(data.nodes.length)
  })

  it('gives every node a position even with no known positions', () => {
    const pos = seedPositions(data, new Map())
    expect(pos.size).toBe(data.nodes.length)
    for (const p of pos.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    }
  })

  it('does not modify the known positions passed in', () => {
    const known = new Map([['a.md', { x: 1, y: 2 }]])
    seedPositions(data, known).get('a.md')!.x = 99
    expect(known.get('a.md')).toEqual({ x: 1, y: 2 })
  })
})

describe('diffGraph', () => {
  it('finds added, removed and changed nodes and edges', () => {
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

  it('everything is empty when nothing changed', () => {
    const d = diffGraph(data, data)
    expect(Object.values(d).every((list) => list.length === 0)).toBe(true)
  })
})

describe('filterEdges', () => {
  it('keeps only the selected types with nodes unchanged; different types between the same pair are different edges', () => {
    const session = { ...edge('a.md', 'b.md'), type: 'same_session' as const }
    const both: GraphData = { nodes: data.nodes, edges: [...data.edges, session] }
    expect(edgeId(session)).not.toBe(edgeId(edge('a.md', 'b.md')))
    expect(filterEdges(both, new Set(['same_session'] as const))).toEqual({
      nodes: data.nodes,
      edges: [session]
    })
    expect(filterEdges(both, new Set()).edges).toEqual([])
    expect(diffGraph(data, both).addEdges).toEqual([session])
  })
})
