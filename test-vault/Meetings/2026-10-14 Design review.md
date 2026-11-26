---
tags: [meeting, knowmon]
attendees: [me, a friend who reviews my side projects]
---

# 2026-10-14 Design review

Reviewed the time layer design from [[Time context links]] and [[Design notes]].

## Decisions

1. Time edges are recomputed in one batch before the graph is read, never incrementally.
2. A session that edits more than 20 notes is treated as a batch operation (sync, global replace) and produces no edges.
3. "Same topic" for sequence edges means "same folder". Tags may come later.

## Open questions

- Should opening a note count towards a session? Decided no: reading isn't writing.
- How should the timeline show a session that crosses midnight? It belongs to the day it started.

## Action items

- [x] Write the session splitting tests
- [x] Add the batch-operation limit to the settings dialog
- [ ] Measure recompute time on a 1000-note vault
