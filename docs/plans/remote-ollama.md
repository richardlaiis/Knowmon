# Plan: add a "Remote Ollama" page to the user guide

## Context

Some users (for example, those with only a weak laptop) want to run the AI on another computer's GPU while still using Knowmon's GUI locally. The code already supports this: the Ollama address in AI settings (`LlmSettings.baseUrl`, `src/shared/llm.ts`) can point to any http(s) address, and every LLM call goes to that URL. What's missing is documentation: `ai-setup.md` only has one sentence in the settings table ("can point to another computer with a GPU on your network"), with nothing on how to install (especially without root) or connect securely.

This task is documentation only: no code changes and no contract changes (`types.ts`, schema and dependencies are untouched).

## Steps

### 1. Save the plan

Save this plan as `docs/plans/remote-ollama.md` (required by CLAUDE.md).

### 2. New pages `docs/user-guide/zh-TW/remote-ollama.md` and `docs/user-guide/en/remote-ollama.md`

Same content in both languages, in the style of `ai-setup.md` (short paragraphs, tables, bash blocks). Outline:

1. **When to use it**: the local machine can't run the models; computation (summaries, Q&A, Agent, embeddings) happens remotely while notes and the index stay local. Note content is sent to the remote machine.
2. **Installing Ollama on the remote machine**
   - With root: the official `install.sh` (link to `ai-setup.md`).
   - Without root: download `ollama-linux-<arch>.tar.zst` from GitHub releases, extract it into `~/.local` and add it to PATH; without `zstd`, decompress to `.tar` locally and `scp` it; AMD GPUs also need the `-rocm` package; the GPU only needs its driver (check with `nvidia-smi`).
   - Starting: `ollama serve`, using `tmux` to keep it running after logging out; confirm with `curl .../api/version`; `ollama pull bge-m3` and `qwen3:8b`.
3. **Connecting** (three options, compared in a table)
   - **SSH tunnel (recommended)**: `ssh -N -L 11434:127.0.0.1:11434 user@host`; Knowmon's address stays the default and the remote machine opens no external port.
   - **Tailscale or another private network**: `OLLAMA_HOST=0.0.0.0` on the remote machine, and the address `http://<tailscale IP>:11434`.
   - **Directly on the same LAN**: as above, with the LAN IP.
4. **Setting it in Knowmon**: AI tab → Settings → Ollama address; the model menus list the models downloaded on the remote machine; this setting is shared by all vaults.
5. **Security**: Ollama has no authentication, so never expose it to the internet; on a shared machine, other accounts on the same host can connect even if it listens only on `127.0.0.1`.
6. **Notes for shared servers**: move model storage with `OLLAMA_MODELS` (home directory quotas); if the port is taken, use `OLLAMA_HOST=127.0.0.1:<port>` and change the tunnel to match; if others are using the GPU, it may slow down or fall back to the CPU.
7. **Troubleshooting**: AI offline → check that the tunnel / `ollama serve` is still running and the address is right; after a disconnect, Knowmon retries automatically every 30 seconds (existing behavior, see `ai-setup.md`).

Don't write anything untested (for example, whether the 2-second connection check misfires on high-latency networks).

### 3. Link to the new page

- `docs/user-guide/{zh-TW,en}/README.md`: add a line to the "AI features (optional)" list.
- `docs/user-guide/{zh-TW,en}/ai-setup.md`: link the Ollama address description in the settings table to the new page.
- `docs/user-guide/{zh-TW,en}/faq.md`: link the "AI is slow" entry to the new page; add a sentence to "Are my notes sent over the internet?": with a remote Ollama, content is sent to that machine.

### 4. Wrap-up

- `docs/roadmap.md`: there's no matching item, so nothing to check off; no design decisions are involved, so `architecture.md` is unchanged.
- No code changes, so no new tests; still run `npm run lint` (to confirm Prettier passes if it covers md).

## Verification

- Every relative link in the new page and the changed places resolves to a file (check with `grep` that link targets exist and anchors match headings).
- The Chinese and English pages have the same sections and commands.
- One local test: run `ollama serve` on another port (for example `OLLAMA_HOST=127.0.0.1:11500`), then either use `ssh -N -L` or set Knowmon's address to `http://127.0.0.1:11500` directly, and confirm the status becomes AI ready and models are listed. If there's no local Ollama, skip it and say so in the report.
- `npm run lint` passes.

## Results (2026-11-11)

- Started a second `OLLAMA_HOST=127.0.0.1:11500 ollama serve` locally and connected to `http://127.0.0.1:11500/` with `cleanLlmSettings` + `createOllama`: `version`, `models` and `embed` all work; `OLLAMA_HOST` also decides which server `ollama pull` talks to (as the docs say).
- There's no local sshd, so the SSH tunnel wasn't tested; a tunnel is just port forwarding, and to Knowmon it's the same as the non-default address above.
- Confirmed the release file name (`ollama-linux-amd64.tar.zst`, v0.40.16) and the extracted layout (`bin/ollama`, `lib/ollama/`).
