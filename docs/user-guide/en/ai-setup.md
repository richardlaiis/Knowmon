# Setting Up Local AI

All of Knowmon's AI features run **on your own computer**, using open models served by [Ollama](https://ollama.com). Your notes are never sent to a cloud service.

AI is optional. Without Ollama, editing, links, Keyword search, the graph, and the timeline all work normally.

## Features that use AI

| Feature                               | Model used                                         |
| ------------------------------------- | -------------------------------------------------- |
| Hybrid search (find notes by meaning) | Embedding model                                    |
| Semantic links in the graph           | Embedding model                                    |
| Summary                               | Chat model                                         |
| Chat (ask your notes)                 | Embedding + chat model                             |
| Agent                                 | Embedding + chat model (must support tool calling) |

## Setup

### 1. Install Ollama

Download and install it from [ollama.com](https://ollama.com). On Linux you can also run:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Ollama usually starts in the background after installing. If not, run `ollama serve`.

### 2. Download the models

```bash
ollama pull bge-m3      # embedding model, about 1.2 GB
ollama pull qwen3:8b    # chat model, about 5 GB
```

These are Knowmon's defaults: `bge-m3` handles both English and Chinese well, and `qwen3:8b` supports tool calling, which the Agent needs.

### 3. Open Knowmon

After you open a vault, the bottom of the left sidebar shows:

1. **Indexing 3/40**: building the semantic index for each note in the background. You can keep working meanwhile.
2. **AI ready**: done; every AI feature is available.

The first index takes a while depending on how many notes you have and how fast your computer is. After that, only new or changed notes are processed.

## The AI tab

The top of the **AI** tab in the right panel (also reachable by clicking the sidebar status) is a status area:

```
● AI ready                         [Retry] [Settings]
qwen3:8b · bge-m3 · 40/40 notes indexed
[ Chat | Agent | Summary ]
```

- **Retry**: check the Ollama connection now.
- **Settings**: open AI settings.
- **Chat / Agent / Summary** switches between the three features — see [Summary and Chat](summary-and-chat.md) and [Agent](agent.md).

## AI settings

| Setting         | Default                  | Description                                                                                               |
| --------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| Chat provider   | Ollama (local)           | Who runs summaries, Chat and the Agent. See [Cloud providers](#cloud-providers-optional)                  |
| Ollama address  | `http://127.0.0.1:11434` | Where Ollama runs. Can point to another machine; see [Using Ollama on a remote machine](remote-ollama.md) |
| Chat model      | `qwen3:8b`               | Used for summaries, Chat, and the Agent                                                                   |
| Embedding model | `bge-m3`                 | Used for Hybrid search and Semantic links                                                                 |

- The model menus list models **already downloaded** in Ollama. They can't be listed while Ollama is offline.
- These settings are **shared by all vaults** and stored in the app's settings file.
- **Changing the embedding model re-indexes every note** (vectors from different models can't be compared).

### Choosing models

- To run the Agent, the chat model must support **tool calling**. If it doesn't, the Agent reports "does not support tool calling"; Summary and Chat still work.
- Bigger models give better results but run slower. On CPU only, `qwen3:8b` takes about 15–30 seconds to summarize a note and 1–4 minutes for an Agent task; a GPU is much faster.
- On a modest machine, try a smaller model (such as `qwen3:4b`) at some cost in quality.

## Status and troubleshooting

| Sidebar shows       | Meaning                       | What to do                                                            |
| ------------------- | ----------------------------- | --------------------------------------------------------------------- |
| AI: checking…       | Connecting                    | Wait a moment                                                         |
| AI offline          | Can't reach Ollama            | Make sure Ollama is running (`ollama serve`) and the address is right |
| Indexing 12/40      | Building the index            | Wait; Hybrid search may be incomplete until it finishes               |
| AI: needs attention | E.g. a model isn't downloaded | Open the AI tab for details; usually `ollama pull <model>` fixes it   |
| AI ready            | All good                      | —                                                                     |

- While Ollama is offline, Knowmon **retries every 30 seconds** and reconnects on its own when Ollama is back. You can also click **Retry**.
- While Ollama is offline: Hybrid search falls back to keyword results; the Chat and Agent inputs say "AI is offline"; everything else is unaffected.

## Cloud providers (optional)

If your computer can't run a local model, summaries, Chat and the Agent can use a cloud API instead: **OpenAI**, **Google Gemini**, or any **OpenAI-compatible** service (OpenRouter, Groq, DeepSeek, Mistral, LM Studio, …).

> **Privacy:** with a cloud provider, note content is sent to that company — the note being summarized, the passages retrieved to answer a question, and the Agent's tool results. Knowmon asks you to confirm this when you switch. Ollama remains the default; nothing is sent anywhere until you choose a cloud provider.

1. Get an API key from the provider (OpenAI: platform.openai.com; Gemini: aistudio.google.com). Usage is billed by the provider.
2. In the AI tab, click **Settings** and pick a **Chat provider**.
3. Paste the **API key**. For **Custom**, also enter the **API address** — the base URL that ends before `/chat/completions`, for example `https://openrouter.ai/api/v1`. It must be `https`, or `http` to this computer (`localhost`).
4. Tick the confirmation and **Save**. If you haven't chosen a model yet, the dialog stays open and the **Model** field suggests the models your key can use; you can also type a model id.

Notes:

- **Embeddings still come from Ollama.** Hybrid search and Semantic links need Ollama with the embedding model. Without Ollama, Chat and the Agent still work through the cloud provider, search falls back to keywords, and the AI tab shows a notice instead of an error.
- The Agent needs a model that supports **tool calling**.
- The API key is **encrypted with your system keyring** (Keychain, Windows credential store, GNOME Keyring / KWallet) and stored in the app's settings file. It is never shown again; you can replace or remove it. If your Linux desktop has no keyring, the dialog warns that the key is not strongly protected.
- Keys and the chosen provider are shared by all vaults, like the other AI settings.
- A rejected key shows an error and Knowmon does **not** retry until you change it; a network failure is retried every 30 seconds.
