# Properties (Frontmatter)

Properties are a YAML block at the very top of a note, between two `---` lines, that describe the note (also called frontmatter):

```markdown
---
date: 2025-12-20
author: James Clear
tags: [books, habits]
---

# Atomic Habits

1. Make it obvious
   …
```

In the editor, the property block is shown in a monospace font with muted colors and a shaded background; Markdown inside it isn't rendered. Properties are optional — notes work fine without them.

## Properties Knowmon uses

| Property | Purpose                                                 | Example                 |
| -------- | ------------------------------------------------------- | ----------------------- |
| `date`   | The note's **event date**: the day its content is about | `date: 2026-10-01`      |
| `tags`   | Tags. The Agent's "add tags" action writes here         | `tags: [books, habits]` |

Any other properties (`author`, `title`, `status`, …) are kept exactly as written; Knowmon just doesn't do anything special with them.

> **Note**: the property block is **not** indexed for search or AI retrieval. If you want a word to be findable, put it in the body.

### `date`: event date

`date` tells Knowmon what day a note is _about_. It affects:

- **Timeline**, "Event date" mode: the note is listed under that day.
- **Time links in the graph**: Same day (notes on the same day) and Sequence (consecutive notes in a folder).
- **Date filters**: the graph's time slider, Hybrid search's date range, and phrases like "last month" or "2026-10-04" in AI Chat.

Accepted formats:

```yaml
date: 2026-10-01
date: 2026/10/1
date: 2026.10.01
date: 2026-10-01 14:30 # only the date part is used
```

**Without `date`**, Knowmon checks whether the file name starts with `YYYY-MM-DD`, such as `2026-10-06.md` or `2026-10-06 standup.md`. A note with neither simply has no event date — and that's normal. Book notes and concept notes don't belong to a particular day.

> **Example**: on Oct 8 you write up the minutes of an Oct 1 meeting. Add `date: 2026-10-01` and the timeline shows it on Oct 1, not Oct 8 when you wrote it. _When_ you wrote it is recorded separately and automatically — see [Time context](time.md).

### `tags`

Any of these works:

```yaml
tags: [books, habits]
```

```yaml
tags:
  - books
  - habits
```

```yaml
tags: books
```

Knowmon doesn't have a tag browser yet. For now, tags are mainly useful to:

- Let the [Agent](agent.md) categorize notes for you ("tag last week's journal entries with `review`").
- Stay compatible with other tools (Obsidian reads `tags` too).

When the Agent adds tags, it changes only the `tags` lines and keeps your existing style. Existing tags are matched ignoring case and `#`, so tags are never duplicated.

### `title`

A note's title is **always its file name**. A `title:` property is just an ordinary property — it doesn't change how the note is named in the file tree, links, or graph. To change the title, rename the file.

## Good to know

- The property block must start on the **first line** of the file.
- If the YAML is broken (an unclosed quote, say), Knowmon treats the note as having no properties. It won't complain or modify your file, but `date` won't take effect and the Agent will refuse to edit that note's tags.
