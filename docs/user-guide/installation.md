# Installation

There are two ways to get Knowmon:

- **[Download an installer](#download-an-installer)** (recommended): no other software needed.
- **[Run from source](#run-from-source-for-developers)**: for developers who want to change the code or try unreleased changes.

## Download an installer

Download the file for your system from the [Releases page](https://github.com/richardlaiis/Knowmon/releases) (under **Assets** of the latest version):

| System                              | File                       |
| ----------------------------------- | -------------------------- |
| Debian, Ubuntu, and derivatives     | `knowmon_0.1.0_amd64.deb`  |
| Fedora, RHEL, Rocky, AlmaLinux      | `knowmon-0.1.0.x86_64.rpm` |
| Other distributions, incl. openSUSE | `knowmon-0.1.0.AppImage`   |
| Windows (experimental)              | `knowmon-0.1.0-setup.exe`  |
| macOS, Apple Silicon (experimental) | `knowmon-0.1.0-arm64.dmg`  |
| macOS, Intel (experimental)         | `knowmon-0.1.0-x64.dmg`    |

Only 64-bit x86 (`x86_64`) Linux is available. Not sure which Mac you have? Apple menu → **About This Mac**: "Chip: Apple M…" means Apple Silicon, "Processor: Intel…" means Intel.

AI features need [Ollama](https://ollama.com), installed separately; Knowmon works without it. See [Setting up local AI](ai-setup.md).

### Linux

- **deb**:

  ```bash
  sudo apt install ./knowmon_0.1.0_amd64.deb
  ```

- **rpm**:

  ```bash
  sudo dnf install ./knowmon-0.1.0.x86_64.rpm
  ```

  The rpm's dependency names follow Fedora's packaging and may not resolve on openSUSE, so use the AppImage there.

Then open Knowmon from your applications menu. To remove it: `sudo apt remove knowmon` or `sudo dnf remove knowmon`.

**AppImage** needs no installation; make it executable and run it:

```bash
chmod +x knowmon-0.1.0.AppImage
./knowmon-0.1.0.AppImage
```

No FUSE 2 (`libfuse2`) is required. On Ubuntu 24.04 and later, AppArmor restricts Chromium's sandbox; the AppImage detects this and starts with `--no-sandbox` automatically. The app works normally but with one less layer of protection, so on Debian / Ubuntu the deb is recommended.

### Windows (experimental)

> The Windows version is built and tested automatically but hasn't been tried on a real machine yet. Please [report problems](https://github.com/richardlaiis/Knowmon/issues).

Run `knowmon-0.1.0-setup.exe`. The installer isn't code-signed, so Windows SmartScreen shows "Windows protected your PC": click **More info → Run anyway**. Knowmon then appears in the Start menu and on the desktop. To remove it: **Settings → Apps → Installed apps → Knowmon → Uninstall**.

### macOS (experimental)

> The macOS versions are built automatically but haven't been tried on a real Mac yet. Please [report problems](https://github.com/richardlaiis/Knowmon/issues).

Open the dmg and drag **Knowmon** into **Applications**.

Knowmon isn't notarized by Apple, so the first launch is blocked by Gatekeeper with a message like "Knowmon is damaged and can't be opened" or "Apple could not verify Knowmon". The app isn't actually damaged; macOS blocks unnotarized apps downloaded from the internet. Remove the download mark in Terminal, then open Knowmon normally:

```bash
xattr -cr /Applications/Knowmon.app
```

You only need to do this once per downloaded version.

## Run from source (for developers)

Running from source takes about ten minutes, mostly downloading.

### Prerequisites

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

### 1. Get the source code

```bash
git clone https://github.com/richardlaiis/Knowmon.git
cd Knowmon
```

### 2. Install dependencies

```bash
npm install
```

This downloads Electron (about 100 MB) and the other packages. The database package, better-sqlite3, ships prebuilt binaries, so you **don't** need a C++ compiler and don't need to rebuild anything.

### 3. Linux: set Electron sandbox permissions

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

### 4. Start Knowmon

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

### 5. (Optional) Set up local AI

Install Ollama and download the models:

```bash
ollama pull bge-m3
ollama pull qwen3:8b
```

See [Setting up local AI](ai-setup.md) for details. Knowmon works without Ollama; only the AI features are unavailable.

### Try the sample vault

The source includes a sample vault, `test-vault/`: about seven weeks of journal entries, book notes, two projects, meeting notes and recipes — handy for exploring the graph, the timeline and the AI features. **Make a copy** first so you don't modify files in the source tree:

```bash
cp -r test-vault ~/knowmon-test-vault
```

Then click **Open folder** in Knowmon and choose `~/knowmon-test-vault`, and start with the **Welcome** note. The notes are in English, except for a small `中文` folder for trying Chinese search and summaries.

> **Keep it under your home folder, not `/tmp`**: `/tmp` has no system trash, so deleting notes there fails.

## Updating

### Installer

Download the new version from the [Releases page](https://github.com/richardlaiis/Knowmon/releases) and install it over the old one, the same way you installed it:

- **deb / rpm**: `sudo apt install ./knowmon_<version>_amd64.deb` or `sudo dnf install ./knowmon-<version>.x86_64.rpm`.
- **AppImage**: replace the old file with the new one.
- **Windows**: run the new `-setup.exe`.
- **macOS**: drag the new Knowmon into Applications, replace the old one, and run `xattr -cr /Applications/Knowmon.app` again.

Knowmon doesn't check for updates itself; watch the Releases page (on GitHub: **Watch → Custom → Releases**) to be notified.

> **Built a 1.0.0 deb yourself earlier?** Self-built installers before the first release were numbered 1.0.0, so apt treats 0.1.0 as a downgrade. Remove the old one first with `sudo apt remove knowmon`. Your notes and settings are kept.

### From source

```bash
cd Knowmon
git pull
npm install
npm start
```

On Linux, if `npm install` downloaded Electron again, repeat step 3.

Your notes live in the vault folder you chose, separate from the app, so updating never touches them. App settings (last vault, Ollama settings, tabs, theme) are kept too.

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

### Linux: the source version crashes right after starting

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

## Building installers yourself

Official installers are built by GitHub Actions on each platform (see `docs/releasing.md`). To build one locally from source:

```bash
npm run build:linux   # Linux: AppImage, deb, and rpm
npm run build:win     # Windows installer
npm run build:mac     # macOS dmg for this Mac's chip
```

Output goes to `dist/`. **You must build on the target OS** (e.g. build the macOS version on a Mac), because only the build machine's platform version of the vector search component is installed.

Building the rpm needs `rpmbuild`: `sudo dnf install rpm-build libxcrypt-compat` on Fedora, `sudo apt install rpm` on Debian / Ubuntu. (On Fedora, the packaging tool's bundled Ruby needs `libcrypt.so.1` from `libxcrypt-compat`; without it the build fails with `error while loading shared libraries: libcrypt.so.1`.) To build only some formats, list them, e.g. `npx electron-vite build && npx electron-builder --linux AppImage deb`.

The packaged app and the from-source version share the same app settings (`~/.config/knowmon/` on Linux), so your last vault, Ollama settings, tabs, and theme carry over.
