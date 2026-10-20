# Knowmon User Guide

> [繁體中文版](../zh-TW/README.md)

Knowmon is a local-first Markdown note-taking app. Your notes are plain `.md` files on your computer; Knowmon links them together, searches them, and draws a map of how they relate. On top of that, it has two things most note apps don't:

- **Time context**: besides the `[[links]]` you write yourself, Knowmon connects notes that you _wrote together_, notes about _the same day_, and _consecutive_ notes in the same folder — automatically.
- **Local AI**: through [Ollama](https://ollama.com), language models run on your own machine. Summarize a note, ask questions about your notes, or hand a multi-step task to the Agent. Your notes never leave your computer.

## Start here

| If you want to…                               | Read                           |
| --------------------------------------------- | ------------------------------ |
| Write your first linked notes in five minutes | [Quickstart](quickstart.md)    |
| Learn what each part of the window does       | [Interface tour](interface.md) |

## The basics

- [Notes and editing](notes-and-editing.md): creating and organizing notes, Markdown, live preview, images
- [Links and backlinks](links.md): how `[[wikilinks]]` work, the Backlinks panel
- [Properties (frontmatter)](properties.md): `date`, `tags`, and how Knowmon uses them
- [Search and Quick switcher](search.md): full-text search, Hybrid (by meaning) search, jumping to notes

## Seeing how notes connect

- [Graph](graph.md): global graph, local graph, filters
- [Time context](time.md): the two kinds of time, time-based links, the Timeline view, settings

## AI features (optional)

- [Setting up local AI](ai-setup.md): installing Ollama, downloading models, status indicators
- [Summary and Chat](summary-and-chat.md): summarize a note, ask your notes questions
- [Agent](agent.md): multi-step tasks such as organizing notes, creating notes, and adding tags

## Reference

- [Keyboard shortcuts](shortcuts.md)
- [Files and data](files-and-data.md): where things are stored, backups, using other tools
- [FAQ](faq.md)

## A few core ideas

1. **Notes are Markdown files.** Nothing to export. Open them in any other editor — including Obsidian.
2. **A folder is a vault.** The folder you pick is your vault. Knowmon keeps its index and edit history in a hidden `.knowmon` folder inside it.
3. **AI is optional.** Without Ollama, everything except the AI tab works as usual.
