# Phase 3 implementation plan: graph view

Done when: the global graph and the per-note local graph are interactive and stay smooth with 1000 notes.

## Confirmed decisions (2026-10-07)

- Layout uses `d3-force` in a Web Worker (a new dependency), and Cytoscape does the drawing.
- The `types.ts` contract changes below are approved.
- Notes that don't exist yet (unresolved wikilinks) aren't shown in the graph at all, so the contract needs no fields for ghost nodes.
- The global graph switches with the editor in the main area.

## Layout algorithm measurements (2026-10-07)

Random graphs with an average of 2 links per note, measured headless on Node 24:

| Notes | Cytoscape built-in `cose` | `cytoscape-fcose` | `d3-force` (300 iterations) |
| ----- | ------------------------- | ----------------- | --------------------------- |
| 300   | 3.3 s                     | —                 | —                           |
| 1000  | 37 s                      | 9.9 s             | 1.8 s                       |
| 2000  | over 2 minutes            | 34 s              | 3.9 s                       |

Both `cose` and `fcose` compute everything before drawing and freeze the UI. `d3-force` is an order of magnitude faster and can run in a Web Worker, returning positions every frame so the graph draws as it settles (as in Obsidian) without blocking the main thread.

**Proposal**: Cytoscape (already installed) handles drawing and interaction, and layout is done by `d3-force` (a new dependency, needs approval) in a Web Worker.

## Data (main process)

Add `getGraph(db)` (`src/main/db/graph.ts`):

- Nodes: every note (path, title, eventDate).
- Edges: rows in `links` with `type = 'wikilink'` and a non-NULL `dst`, expressed as paths; multiple rows for the same pair are merged with weights added; self-links are excluded.
- Targets that don't exist (`dst IS NULL`) aren't returned.
- The query should finish within tens of ms at 1000 notes (add a test).

## IPC contract changes (`src/shared/types.ts`, need approval)

```ts
export type LinkType = 'wikilink' // phases 4 and 5 add same_session, same_day, sequence, semantic

export interface GraphNode {
  path: string
  title: string
  eventDate: string | null
}

export interface GraphEdge {
  source: string // note path
  target: string
  type: LinkType
  weight: number
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// Added to KnowmonAPI:
graph: {
  get(): Promise<GraphData>
}
```

The local graph is computed in the renderer from the global data with a BFS; no extra IPC.

## Renderer (`src/renderer/graph/`)

- `model.ts` (pure, with tests): adjacency lists, `localSubgraph(data, center, depth)` (undirected BFS), the neighbors to highlight on hover, node size by link count, initial positions for new nodes (next to neighbors that already have positions).
- `forceLayout.ts` (pure, with tests): wraps the d3-force simulation (link, charge, center, collide), with support for pinning dragged nodes.
- `layout.worker.ts`: runs that simulation in a Worker, returning positions every frame as a `Float32Array` (transferable) and stopping once it converges; reheats on "drag" and "data changed".
- `GraphView.tsx`: Cytoscape with the `preset` layout, updating positions with `cy.batch()` as they arrive.
  - Interaction: wheel zoom, drag to pan, drag nodes, click to open a note, hover highlights the node and its neighbors (other nodes and edges fade).
  - Performance settings: `textureOnViewport`, `hideEdgesOnViewport`, labels hidden when zoomed out (`min-zoomed-font-size`).
  - Colors come from CSS variables in `main.css`, and styles are reapplied when the theme changes. The currently open note is shown in the accent color.
- Position cache: node positions for the same vault are kept in memory, so reopening the graph or updating data doesn't redo the whole layout. Not written to disk.
- Data updates: reuse phase 2's `indexVersion`; after refetching, only changed nodes and edges are added or removed, with a gentle reheat.

## Layout

- **Global graph**: switches with the editor in the main area (sidebar button or `Ctrl/Cmd+G`); the open note is kept and isn't reloaded when switching back.
- **Local graph**: the right panel gets two tabs, "Backlinks / Local graph"; the local graph has a depth of 1–3, and clicking a node opens the note.
- Graph controls: toggle labels, re-run layout. Settings are stored in localStorage.

## Performance tests

- `scripts/gen-vault.mjs`: generates N test notes (Chinese titles, random wikilinks, some journal file names) into a given folder, not committed to git.
- vitest: `getGraph` time at 5000 notes, `localSubgraph` correctness, time for `forceLayout` to converge at 1000 nodes (a loose limit, to avoid false failures across machines).
- Running the real app (driven over CDP as in phase 2): with 1000- and 3000-note vaults, measure the time from opening the graph to the first draw and to layout convergence, and the main thread's long tasks during hover and zoom; record the results in this document.

## Order of work (check off the roadmap after each item passes its tests; the user handles commits)

1. `getGraph` + IPC + tests
2. Model and layout (pure functions + Worker) + tests
3. Global graph view and interaction
4. Local graph panel
5. Generate large vaults, measure and tune performance

## Performance results (2026-10-07)

Environment: Intel Arc (Mesa), Electron offscreen rendering with the GPU (`useSharedTexture`), driving the real app over CDP. Test vaults were generated by `scripts/gen-vault.mjs`. fps is counted with `requestAnimationFrame`; long tasks are main-thread tasks over 50 ms.

| Action                                                  | 1000 notes (1908 links)   | 3000 notes (5799 links) |
| ------------------------------------------------------- | ------------------------- | ----------------------- |
| Open the vault (indexing)                               | 1.8 s                     | 6.7 s                   |
| First opening of the graph                              | One pause of about 0.45 s | One pause of about 1 s  |
| Layout (computed in the Worker, applied once when done) | 2.3 s, UI usable, ~38 fps | 6.8 s, ~34 fps          |
| Zoom                                                    | ~56 fps                   | ~46 fps                 |
| Pan                                                     | ~60 fps                   | ~54 fps                 |
| Hover highlight                                         | ~21 fps, 50–80 ms each    | ~7 fps, 150–240 ms each |
| Reopening the graph                                     | Instant (no long task)    | Instant                 |

### Findings and adjustments along the way

- At first, positions were applied to Cytoscape every frame (drawing while computing), giving only ~11 fps at 1000 notes: each full redraw of the Cytoscape canvas takes about 45 ms (half for edges, half for nodes; tweaking styles didn't help). Above 500 nodes, the Worker now returns positions only once after converging, with progress shown in the toolbar meanwhile.
- Adding a fade class to every element on hover restyles the whole graph; above 500 nodes, hover only highlights neighbors without fading the rest.
- After the global graph is first opened it stays in the background (hidden), so reopening it doesn't rebuild it.
- Tried Cytoscape's experimental WebGL renderer: redraws were about twice as fast (hover ~39 fps), but it does hit-testing with GPU readback and nodes couldn't be clicked at all in testing, so it wasn't adopted.
- Tried delaying the hover highlight by 60 ms: no measurable improvement (the cost is mostly Cytoscape's mouse-move handling and redrawing), so it wasn't kept.
- The user decided to stay with the Cytoscape canvas (2026-10-07): it's usable up to about 1000 notes, and sigma.js (WebGL) will be evaluated for more.

## Overlapping labels (2026-10-07)

The collision force originally considered only the node's circle (radius 5–18 px), but labels are usually 60–150 px wide. Measured with Cytoscape's real label boxes: 2 overlapping pairs in the test vault, 1696 pairs (938 labels) at 1000 notes.

- Collision now uses a rectangle covering the node plus the label below it (`src/renderer/graph/labelCollide.ts`, grid partitioning, about O(n) per step), with one collision-only pass after convergence (pushing apart boxes that still overlap, moving 2–7 px).
- Changing collision alone wasn't enough: centering and link forces squeezed nodes back together. After a parameter sweep: link distance 50 → 70, repulsion -90 → -250 with no distanceMax, centering 0.04 → 0.01, 3 collision iterations per step.

| Parameters (random graph, 2 links per note) | 300 notes             | 1000 notes | 3000 notes |
| ------------------------------------------- | --------------------- | ---------- | ---------- |
| Original                                    | 205 overlapping pairs | 1377       | 8379       |
| Tuned (with the final pass)                 | 0                     | 0          | 7          |

- In the app: 0 overlapping pairs for both the test vault and 1000 notes; the graph is more spread out (about 2.8× wider at 1000 notes), layout time is unchanged, ~55 fps during layout and ~50 fps on hover (better than before, since elements are less dense).
