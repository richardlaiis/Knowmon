---
date: 2026-10-06
tags: [knowmon, design]
---

# Time context links

Ordinary links only connect notes I remembered to link. Time context links add the connections I didn't write down:

| Edge     | Based on     | Rule                                                                 |
| -------- | ------------ | -------------------------------------------------------------------- |
| Session  | Written time | Notes edited in the same sitting                                     |
| Same day | Event date   | Notes about the same day (for example a journal entry and a meeting) |
| Sequence | Event date   | The previous and next note in the same folder                        |

Example: [[2026-10-14]] and [[2026-10-14 Design review]] are about the same day, so they get a Same day edge even though one only mentions the other in passing.

The design was settled in the [[2026-10-14 Design review]]; the implementation is tracked in the [[Dev log]].
