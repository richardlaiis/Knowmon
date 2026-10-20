# Installation

There are no released installers for Knowmon yet, so you run it from source. It takes about ten minutes, mostly downloading.

## Prerequisites

| Software                      | Version                      | Used for                                   | Check with      |
| ----------------------------- | ---------------------------- | ------------------------------------------ | --------------- |
| [Node.js](https://nodejs.org) | 22 or later (24 recommended) | Building and running Knowmon; includes npm | `node -v`       |
| [Git](https://git-scm.com)    | Any recent version           | Getting the source code                    | `git --version` |
| [Ollama](https://ollama.com)  | Any recent version           | **Optional** — only for AI features        | `ollama -v`     |

Linux, macOS, and Windows are supported. Only the steps marked "Linux" below are Linux-specific.

> **Tip for installing Node.js**: use [nvm](https://github.com/nvm-sh/nvm) (Linux / macOS) or [nvm-windows](https://github.com/coreybutler/nvm-windows), which makes switching versions easy later:
>
> ```bash
> nvm install 24
> nvm use 24
> ```

## 1. Get the source code

```bash
git clone https://github.com/richardlaiis/Knowmon.git
cd Knowmon
```

## 2. Install dependencies

```bash
npm install
```

This downloads Electron (about 100 MB) and the other packages. The database package, better-sqlite3, ships prebuilt binaries, so you **don't** need a C++ compiler and don't need to rebuild anything.

## 3. Linux: set Electron sandbox permissions

> Linux only. Skip this on macOS and Windows.

Do this once before the first run, or the app exits immediately with `The SUID sandbox helper binary was found, but is not configured correctly`:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Repeat it whenever you reinstall `node_modules` (for example, after deleting it and running `npm install` again).

If you'd rather not use `sudo`, start the app with the sandbox disabled instead (only advisable on your own machine):

```bash
npx electron-vite dev -- --no-sandbox
```

## 4. Start Knowmon

Pick one:

```bash
# Option A: everyday use (recommended)
npm start
```

```bash
# Option B: development mode (the window updates as the code changes)
npm run dev
```

When you see the welcome screen with an **Open folder** button, you're done. Continue with the [Quickstart](quickstart.md).

> `npm start` builds the app before each launch, which takes a few seconds. To skip that after the first time, run `npm start -- --skipBuild` to launch the last build directly (run plain `npm start` again after updating the source).

## 5. (Optional) Set up local AI

Install Ollama and download the models:

```bash
ollama pull bge-m3
ollama pull qwen3:8b
```

See [Setting up local AI](ai-setup.md) for details. Knowmon works without Ollama; only the AI features are unavailable.

## Try the sample vault

The source includes a sample vault, `test-vault/`, with journal entries, book notes, and project notes — handy for exploring the features. **Make a copy** first so you don't modify files in the source tree:

```bash
cp -r test-vault ~/knowmon-test-vault
```

Then click **Open folder** in Knowmon and choose `~/knowmon-test-vault`. (The sample notes are in Chinese.)

> **Keep it under your home folder, not `/tmp`**: `/tmp` has no system trash, so deleting notes there fails.

## Updating

```bash
cd Knowmon
git pull
npm install
npm start
```

On Linux, if `npm install` downloaded Electron again, repeat step 3.

Your notes live in the vault folder you chose, separate from the source folder, so updating never touches them.

## Installation troubleshooting

### `Electron failed to install correctly`

The Electron binary didn't finish downloading (common on flaky connections). Download it again:

```bash
node node_modules/electron/install.js
```

If it keeps failing, try a mirror:

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node node_modules/electron/install.js
```

### Linux: the app crashes right after starting

Most likely step 3 (sandbox permissions) was skipped. Look for a `SUID sandbox helper` message in the terminal.

### Warnings in the terminal

These are normal on Linux and safe to ignore:

| Message                                                        | Cause                                                          |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| `vaInitialize failed: unknown libva error`                     | No hardware video decoding driver; software decoding is used   |
| `components/dbus/xdg/request.cc ... Request cancelled by user` | You cancelled the folder picker                                |
| `GLib-GObject ... has no handler with id`                      | A warning when moving files to the trash; deletion still works |
| `wayland_object.cc ... Binding to ... version`                 | A Wayland protocol version notice                              |

### Node.js is too old

If `node -v` shows a version below 22, upgrade Node.js (see nvm above), delete `node_modules`, and run `npm install` again.

## Building installers yourself (experimental)

> Packaging is still in progress (phase 8 of the roadmap) and hasn't been fully verified. In particular, **the vector search component may not be packaged correctly**, so Hybrid search and Semantic links may not work in a packaged build. For normal use, run from source as described above.

```bash
npm run build:linux   # AppImage, deb, and snap (snap requires snapcraft)
npm run build:win     # Windows installer
npm run build:mac     # macOS dmg
```

Output goes to `dist/`. You generally need to build on the target OS (e.g. build the macOS version on a Mac).
