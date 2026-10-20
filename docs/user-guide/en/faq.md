# FAQ

## General

### Will Knowmon change my existing notes?

Not on its own. When you open a vault, Knowmon only reads files and builds an index. Notes are written only when you edit them, click a checkbox, or click **Apply** on an Agent approval card.

### Why doesn't Knowmon reopen my last vault?

That's intentional. When you click **Open folder**, the dialog starts in your last vault's location, so it's one click away.

### Can I open several vaults at once?

One at a time. Click the vault name at the top left to switch; each vault remembers its own open tabs.

### Which operating systems are supported?

Linux, macOS, and Windows. On macOS, use `Cmd` wherever this guide says `Ctrl`.

## Editing

### I renamed a note and links to it broke

Renaming doesn't update `[[Old name]]` links in other notes. Search for the old name with `Ctrl+Shift+F` and fix them.

### I never pressed save. Is my work safe?

Yes. Knowmon saves 0.5 seconds after you stop typing, and also before switching tabs, closing tabs, or switching vaults.

### Clicking a link does nothing

Links open with **`Ctrl`+click**. A plain click just moves the cursor so you can edit the link text.

### Why isn't `Ctrl+G` "find next"?

In Knowmon, `Ctrl+G` opens the graph. Use `F3` / `Shift+F3` to find next / previous.

### My image doesn't show

Check that:

- You used `![caption](path)`, not `![[file name]]`.
- The path is **relative to the note**. For a note in `Journal/` and an image in the root `attachments/` folder, write `../attachments/pic.png`.
- It's not a web address or an absolute path.
- You're not in source mode (`Ctrl+E`).

A red "Image not found" means the syntax is fine but the file wasn't found.

### Tables aren't rendered

The editor doesn't render tables yet; they show as plain Markdown (in AI summaries too).

## Search

### A word I know I wrote isn't found

- Keyword mode requires **all** words to appear; try fewer words.
- Is the word in the frontmatter? Properties aren't searched.
- Try Hybrid mode to search by meaning.

### Hybrid search says "Semantic search is unavailable"

Ollama isn't running, the embedding model isn't downloaded, or the index isn't ready. Check the AI status at the bottom of the left sidebar and see [Setting up local AI](ai-setup.md#status-and-troubleshooting).

## Graph and time

### There are no Session links in my graph

Session links require that you've actually **edited** notes in Knowmon (or while it was open). A freshly opened vault only has one "created" entry per note, which doesn't count. Edit two notes within 30 minutes of each other, then check the graph.

Also, a session that edits more than 20 notes is treated as a bulk operation and produces no Session links. You can change that in Settings.

### The timeline's Event date mode is empty

Your notes don't have event dates yet. Add `date: 2026-10-20` to the frontmatter, or start the file name with `2026-10-20`. See [Properties](properties.md#date-event-date).

### Switching Event date / Written on the graph's time bar changes nothing

With the slider at full range and Undated checked (the default), both show every note. Narrow the slider or uncheck Undated to see the difference.

### The graph layout is a mess

Click **Re-layout** in the toolbar. You can also turn off some edge types to focus on the connections you care about.

## AI

### It keeps saying "AI offline"

1. Check that Ollama is running: `ollama list` in a terminal should respond.
2. Check the address under **Settings** in the AI tab (default `http://127.0.0.1:11434`).
3. Click **Retry**.

### It says "AI: needs attention"

Usually a model isn't downloaded. Open the AI tab for details; for example, run `ollama pull bge-m3`.

### Summaries come out in Chinese

The default summary language is Chinese. Click **EN** in the Summary view, then **Regenerate**. Knowmon remembers the choice. (Chat and the Agent already answer in the language you ask in.)

### AI is slow

On CPU only, a summary takes about 15–30 seconds and an Agent task about 1–4 minutes. That's normal. You can:

- Use a computer with a GPU, or point the Ollama address in AI settings at a machine on your network that has one.
- Switch to a smaller chat model (at some cost in quality).
- Narrow Agent tasks, e.g. by naming a date range or specific notes.

### The Agent says "does not support tool calling"

The current chat model can't use tools. Choose one that can, such as `qwen3:8b`, in AI settings.

### The AI's answer is wrong

- Check the sources under the answer to see which notes it used.
- Time phrases in your question become filters; make sure the range shown above the input is what you meant.
- If the question is vague, rephrase it using words likely to appear in your notes.
- Earlier messages may be steering it; click **New chat** to start over.

### Are my notes sent over the internet?

No. All AI processing happens on the Ollama server you configure — your own computer by default.

## Data

### Can I delete the `.knowmon` folder?

You can delete `index.db`; it's rebuilt automatically. But **don't delete `events.jsonl`**. It holds your writing history, can't be recovered, and time-based features would lose all past data. See [Files and data](files-and-data.md).

### Deleting a note says "Failed to move item to trash"

The vault is somewhere without system trash support (such as `/tmp`). Keep your vault under your home folder.
