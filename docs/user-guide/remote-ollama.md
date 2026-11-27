# Using Ollama on a Remote Machine

> Read [Setting up local AI](ai-setup.md) first to see which models the AI features use.

If your computer can't run language models well, another machine (a desktop with a GPU, a lab or work server) can run Ollama while you keep using Knowmon on your own computer:

- **Runs on the remote machine**: the processing for Summary, Chat, the Agent, and the semantic index (embeddings).
- **Stays on your computer**: your note files, the index database, the graph, search, and every non-AI feature.

> With a remote Ollama, note content (the note being summarized, your questions, retrieved passages) is sent to that machine for processing. Only connect to machines you trust.

## 1. Install Ollama on the remote machine

### With administrator (root) access

Use the official installer, the same as on your own computer:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### Without administrator access

The official installer needs `sudo`; instead, unpack Ollama into your home directory. Check the CPU architecture with `uname -m` first: use `amd64` for `x86_64` and `arm64` for `aarch64`.

```bash
mkdir -p ~/.local
curl -fL https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tar.zst \
  | tar --zstd -x -C ~/.local
```

This creates `~/.local/bin/ollama` and `~/.local/lib/ollama/`. Add `~/.local/bin` to your PATH (put it in `~/.bashrc`; it takes effect on your next login):

```bash
export PATH="$HOME/.local/bin:$PATH"
```

- **`tar: zstd: Cannot exec`**: the remote machine doesn't have `zstd`. Download and unpack to a `.tar` on your own computer, then copy it over:

  ```bash
  # on your computer
  curl -fLO https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tar.zst
  zstd -d ollama-linux-amd64.tar.zst
  scp ollama-linux-amd64.tar user@remote:
  # on the remote machine
  mkdir -p ~/.local && tar -xf ollama-linux-amd64.tar -C ~/.local
  ```

- **AMD GPUs**: also download `ollama-linux-amd64-rocm.tar.zst` and unpack it into `~/.local` the same way.
- **GPU**: Ollama ships its own CUDA libraries; it only needs the graphics driver. If `nvidia-smi` prints a table, the driver is installed. Installing a driver needs an administrator. Ollama also runs without a GPU, just slowly.

### Start it and download the models

```bash
ollama serve
```

To keep Ollama running after you log out of SSH, the simplest way is to run it inside `tmux` (or `screen`):

```bash
tmux new -s ollama   # start a tmux session
ollama serve
# press Ctrl+B, then D to detach; Ollama keeps running. Return with tmux attach -t ollama
```

In another terminal on the remote machine, check that Ollama responds and download the models:

```bash
curl http://127.0.0.1:11434/api/version
ollama pull bge-m3
ollama pull qwen3:8b
```

## 2. Connect from your computer

| Method                   | Good for                                             | Ollama address in Knowmon                 |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------- |
| SSH tunnel (recommended) | You can log in to the remote machine with SSH        | Keep the default `http://127.0.0.1:11434` |
| Tailscale or similar VPN | You can install Tailscale on both machines           | `http://<remote Tailscale IP>:11434`      |
| Same local network       | Both machines are on the same home or office network | `http://<remote LAN IP>:11434`            |

### SSH tunnel (recommended)

Run this **on your own computer** and leave it open while you use Knowmon:

```bash
ssh -N -L 11434:127.0.0.1:11434 user@remote
```

This forwards `127.0.0.1:11434` on your computer to Ollama on the remote machine. Knowmon's settings stay the same, and the remote Ollama is never exposed to the network.

- If Ollama is already running on your computer and using port 11434, pick another local port, for example `-L 11500:127.0.0.1:11434`, and set the address in Knowmon to `http://127.0.0.1:11500`.
- To run the tunnel in the background, add `-f`: `ssh -f -N -L ...`.

### Tailscale or the local network

By default the remote Ollama only accepts connections from the same machine. To accept connections from other computers:

```bash
OLLAMA_HOST=0.0.0.0 ollama serve
```

Then enter the remote IP in Knowmon. Read "Security" below before using `0.0.0.0`.

## 3. Set up Knowmon

1. Open the **AI** tab in the right panel and click **Settings**.
2. Set **Ollama address** to the address from the previous step (with an SSH tunnel on the default port, leave it unchanged).
3. After saving, the bottom of the left sidebar should change to **AI ready** (or **Indexing** first) within a few seconds. The model menus list the models downloaded on the **remote** machine.

This setting is shared by all vaults. To stop using the remote machine, change the address back to `http://127.0.0.1:11434`.

## Security

- **Ollama has no password or authentication.** Anyone who can reach it can use it and see what is sent to it. **Never expose Ollama directly to the internet** (for example, `0.0.0.0` on a server with a public IP). Only you can reach it through an SSH tunnel or Tailscale.
- **Shared servers**: even when Ollama listens only on `127.0.0.1`, other accounts on the same machine can still connect to your Ollama. No setting prevents this; think twice if your notes are private.

## Notes for shared servers

- **Not enough space in your home directory**: models are stored in `~/.ollama/models` by default; `bge-m3` plus `qwen3:8b` take about 6 GB. Store them on another disk by setting this before both `ollama serve` and `ollama pull`:

  ```bash
  export OLLAMA_MODELS=/other/disk/your-account/ollama-models
  ```

- **Port 11434 is already taken** (someone else runs Ollama; `ollama serve` says `address already in use`): use another port and point the SSH tunnel at it. Knowmon's settings stay the same:

  ```bash
  # on the remote machine
  OLLAMA_HOST=127.0.0.1:11500 ollama serve
  # on your computer
  ssh -N -L 11434:127.0.0.1:11500 user@remote
  ```

  Set the same `OLLAMA_HOST` when you run `ollama pull` on the remote machine, or it will talk to someone else's Ollama.

- **Someone else is using the GPU**: when GPU memory runs out, models may run slower or fall back to the CPU.

## Troubleshooting

| Problem                              | Check                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| AI offline                           | Is the SSH tunnel still open? Is `ollama serve` still running on the remote (`tmux attach -t ollama`)? Is the address correct? |
| Model menus empty or missing a model | Run `ollama list` **on the remote machine** and `ollama pull` what's missing                                                   |
| `ssh` says `Address already in use`  | Port 11434 on your computer is taken (usually by a local Ollama); use another local port, see the SSH tunnel section           |
| Slow                                 | Run `nvidia-smi` on the remote machine to check that Ollama is using the GPU                                                   |

When the connection drops, Knowmon retries every 30 seconds and reconnects on its own once the connection is back; you can also click **Retry** in the AI tab.
