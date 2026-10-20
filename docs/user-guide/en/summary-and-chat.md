# Summary and Chat

> Requires [local AI](ai-setup.md).

The **AI** tab in the right panel has three modes: **Chat**, **Agent**, and **Summary**. This page covers Summary and Chat; for the Agent, see [Agent](agent.md).

## Summary

Condense a long note into its key points.

### How to use it

1. Open the note you want to summarize.
2. Press `Ctrl+Shift+S`, or click **Summarize** at the top right of the note.
3. The right panel switches to AI → Summary and the bullet-point summary streams in.

**Only want part of it?** Select that text first, then press `Ctrl+Shift+S`. The heading reads "Selection in _note name_".

### What you get

- Bullet points, with formatting like bold, lists, and code rendered.
- **`[[links]]` from the original note are kept** and clickable (`Ctrl`+click opens a new tab). The AI can't invent links that weren't in the note.
- Very long notes (over about 12,000 characters) are summarized in parts and then combined, so they take longer.

### Buttons

| Button         | Action                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| **中文 / EN**  | Summarize in Traditional Chinese or English. Your choice is remembered |
| **Stop**       | Stop partway                                                           |
| **Regenerate** | Summarize again (for example after switching language)                 |
| **Copy**       | Copy the summary as Markdown, ready to paste into a note               |

> **Tip**: The default language is Chinese (中文). Click **EN** once for English summaries — Knowmon remembers it. This also lets you get an English summary of a Chinese note, or the other way around; links stay exactly as in the original.

## Chat

Ask your notes a question. The AI first searches for relevant notes, answers only from what it found, and cites where each statement came from.

### How to use it

Press `Ctrl+Shift+A` to open Chat with the cursor in the input box. Type a question and press `Enter` (`Shift+Enter` for a new line).

```
What are the main ideas in Deep Work?
```

You'll see:

1. "Searching notes…" while it looks for relevant notes.
2. The answer streaming in, with citation numbers like **[1]** and **[2]** after sentences.
3. The cited sources listed below the answer.

**Click a citation or source** to open that note and scroll to the cited passage (`Ctrl`+click for a new tab). Notes that were searched but not cited are tucked under "sources searched".

### Narrowing by time

Mention a time in your question and Knowmon detects it, answering only from notes in that period. The detected range appears above the input box as you type.

| You can write                              | Range                           |
| ------------------------------------------ | ------------------------------- |
| today, yesterday, the day before yesterday | That day                        |
| this week, last week                       | Monday to Sunday                |
| this month, last month                     | The whole month                 |
| this year, last year                       | The whole year                  |
| past 7 days, last 2 weeks, past 3 months   | Up to and including today       |
| September, in May                          | The most recent September / May |
| `2026-09`, September 2026                  | That month                      |
| `2026-10-04`                               | That day                        |
| `2026-10-04 to 2026-10-06`                 | A date range                    |
| 今天, 上週, 上個月, 最近 7 天, 9 月 …      | The Chinese equivalents         |

Knowmon uses each note's **event date** (the `date` property or a dated file name), falling back to its last-modified date.

**Examples**:

```
Which books did I read last month, and what did I think of them?
```

```
What did I do from 2026-10-04 to 2026-10-06?
```

A question with a time but no topic ("What did I write last week?") simply uses the notes from that period as sources.

#### Adjusting the range

| Action                                 | Result                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| Click **×** next to the detected range | Don't filter by date this time (shows "No date filter"; click it to restore) |
| **Date range…**                        | Pick start and end dates yourself                                            |

A manual range applies only to the next question; after sending, it goes back to automatic detection.

### Follow-up questions

Chat remembers the last few exchanges, so you can follow up:

```
What are the main ideas in Deep Work?
How would I put the second one into practice?
```

To change topics, click **New chat** to clear the conversation so earlier questions don't get in the way.

### Answer language

The AI answers in the language you ask in: ask in English, get English; ask in Chinese, get Traditional Chinese.

### An honest "I don't know"

If your notes don't cover the question, the AI says so instead of making something up. If no relevant notes are found at all, it doesn't even call the model.

### Saving an answer as a note

Click **Copy** under an answer and paste it into a note. Citation numbers become `[[Source title]]` links, so your new note links back to its sources.

### Also

- **Stop** halts an answer partway.
- Conversations live only in memory and are cleared when you quit or switch vaults.
- `Enter` pressed while composing with an input method (IME) doesn't send.

## Which one should I use?

| You want to…                                                      | Use                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| Get the gist of one long note                                     | Summary                                             |
| Find answers across many notes, or review a period                | Chat                                                |
| Have the AI organize, create notes, or add tags — not just answer | [Agent](agent.md)                                   |
| Just find a note                                                  | [Hybrid search](search.md#hybrid-search-by-meaning) |
