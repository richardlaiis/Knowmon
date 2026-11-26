---
title: Dev log
date: 2026-10-01
tags: [project, knowmon]
---

# Knowmon dev log

## Phase 4: time layer (October)

- Session splitting: a gap of more than 30 minutes between edits starts a new session.
- Same-day and sequence edges from event dates. See [[Time context links]].
- Decisions from the [[2026-10-14 Design review]].

## Phase 6: Q&A (October)

- Started as a tracer bullet, per [[The Pragmatic Programmer]]: question → retrieval → streamed answer with `[n]` citations.
- Chinese questions have no spaces, so full-text search uses keywords combined with OR.

## Phase 7: agent (November)

- Read-only tools run directly; `create_note` and `add_tags` only propose changes until I click **Apply**.

## Phase 8: polish (November)

- Cloud chat providers ([[2026-11-16]]). API keys are encrypted with the OS keyring and never reach the renderer.
- Configurable context length and max output ([[2026-11-25]]).

Longer reasoning lives in [[Design notes]]. Loose ideas go in [[Knowmon/Ideas]].
