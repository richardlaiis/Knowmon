# Agent

> Requires [local AI](ai-setup.md), with a chat model that supports tool calling (the default `qwen3:8b` does).

[Chat](summary-and-chat.md#chat) answers questions. The **Agent** goes further: it decides for itself what to search, which notes to read, and which connections to check, working step by step through bigger tasks — and, when needed, it can **create a note** or **add tags**.

Anything that would change your vault **waits for your approval first**.

## Starting a task

Press `Ctrl+Shift+G` (or switch the AI tab to **Agent**), describe the task, and press `Enter` or **Run**.

The first time, the panel shows a few example tasks (in Chinese); click one to fill it in. In English, tasks look like:

- What notes did I write last week, and what does each one link to?
- Collect my notes about habits into one summary note
- Tag this month's journal entries with "review"

## What the Agent can do

The Agent has six tools and picks whichever the task needs:

| Tool                   | What it does                                                   | Step shown as                                |
| ---------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| Search notes           | Search by keywords and meaning, optionally within a period     | Search "habits" → 5 notes                    |
| Read a note            | Read a note's content; long notes are read in parts            | Read Atomic Habits                           |
| Get connections        | List a note's links, backlinks, time links, and Semantic links | Connections of Deep Work → 4 notes           |
| List notes in a period | E.g. "last week", "2026-10"                                    | Notes from 2026-10-04 – 2026-10-06 → 3 notes |
| Create note ✎          | Create a new note (**needs approval**)                         | Create Summaries/Comparison.md               |
| Add tags ✎             | Add tags to the `tags` property (**needs approval**)           | Add #review to 2026-10-04                    |

> The Agent **never** edits or deletes the body of an existing note, and never renames or moves files. When creating a note, it never overwrites an existing file.

## Following along

As the task runs, the panel lists each step:

| Icon    | Meaning                                                   |
| ------- | --------------------------------------------------------- |
| Spinner | Running                                                   |
| ✓       | Done                                                      |
| !       | Error (the Agent sees the error and tries something else) |
| ?       | Waiting for your approval                                 |
| ✕       | You rejected this change                                  |

**Expand a step** to see the arguments the Agent passed and the notes it found. Click a note to open it; `Ctrl`+click for a new tab.

Text between steps is shown faded (the Agent thinking out loud); the text after the last step is the **final answer**. `[[Links]]` in the final answer are clickable.

## Approving changes

When the Agent wants to create a note or add tags, an **approval card** appears. The Agent button, the AI tab, and the bottom of the left sidebar also flag it ("Agent: confirm a change").

### Creating a note

The card shows the **path** and **content**, both editable. If the content links to notes that don't exist, the card lists them ("Links to notes that don't exist yet: …") so you can decide whether to fix them.

### Adding tags

The card shows the tags to add (remove any with its ×) and the frontmatter before and after.

### Your choices

| Button     | Result                                                        |
| ---------- | ------------------------------------------------------------- |
| **Apply**  | Write the change as shown on the card, including your edits   |
| **Reject** | Don't write it; the Agent is told, and explains in its answer |
| **Stop**   | Stop the whole task; a pending change isn't written           |

> You can keep editing notes while a card is waiting. When adding tags, Knowmon re-reads the file at the moment you click Apply, so your latest edits aren't overwritten. If that note is open, it reloads afterwards.

## Examples

### Review a period

```
Which notes did I write from 2026-10-04 to 2026-10-06, and what does each link to?
```

The Agent lists the notes from those three days, checks each one's connections, and sums up (illustrative):

```
✓ Notes from 2026-10-04 – 2026-10-06 → 3 notes
✓ Connections of 2026-10-04 → 2 notes
✓ Connections of 2026-10-05 → 4 notes
✓ Connections of 2026-10-06 → 3 notes

Those three days of journal entries revolve around two themes: …
```

### Combine notes into a new one

```
Compare "Atomic Habits" and "Deep Work" in a new note in the "Summaries" folder
```

The Agent reads both notes and proposes a new one for you to approve. Adjust the title or content if you like, then click **Apply**. The new note appears in the file tree right away.

### Tag in bulk

```
Tag last week's journal entries with "review"
```

Each note gets its own approval card. Notes that already have the tag are skipped without asking.

## Writing good tasks

- **Be clear about scope**: "last week's journal entries" beats "my recent notes". Just say the time ("last week", "this month", "2026-09") — Knowmon converts it to dates itself instead of relying on the model's arithmetic.
- **Name notes directly**: "Atomic Habits" or `[[Atomic Habits]]` both work.
- **Say what you want back**: an answer, a new note, or tags? For a new note, say which folder.
- **One thing at a time**: each task can use tools at most 5 times and read a limited amount of text, so very large tasks may not finish. Split them up, or continue in the same session ("now also…").

## Good to know

- **Speed**: on CPU only, a task takes about 1–4 minutes; a GPU is much faster. The more it reads, the slower it gets.
- **Follow-up tasks**: the Agent remembers earlier tasks and their final answers, so you can build on them. Click **New task** to start fresh.
- **Language**: the Agent answers in the language of your task.
- **Trustworthy links**: the final answer keeps only links to notes that really came up; invented links become plain text.
- Task history lives only in memory and is cleared when you quit or switch vaults; a pending change counts as rejected.
- If you switch to a model without tool support, you'll see "does not support tool calling". Choose another model in [AI settings](ai-setup.md#ai-settings).
