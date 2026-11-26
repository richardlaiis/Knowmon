# Phase 8 task 1: trial packaging on Linux

## Context

The last item of phase 8 is "produce installers", but so far the project has only run from source, and packaging has never really been tried. Packaging is the riskiest part of phase 8, so it comes first: build a deb and an AppImage on Linux and confirm that every feature (including the AI vector features) works after installing. Leftover template settings get cleaned up too. The settings page and performance work are later tasks; the final task does the release version, packaging for all three platforms and the documentation wrap-up.

Known problems so far:

1. **sqlite-vec fails to load in the packaged app.** `loadVectorExtension` in `src/main/db/index.ts` calls `sqliteVec.load(db)`. That finds `vec0.so` with `require.resolve`, which after packaging lands at `…/resources/app.asar/node_modules/sqlite-vec-linux-x64/vec0.so`. When that path is handed to SQLite's C-level `dlopen`, Electron's asar redirection doesn't apply, so it can't load. Worse, `asarUnpack` in `electron-builder.yml` only covers `resources/**`, so the `.so` isn't on disk at all. As a result, Hybrid search, Semantic edges, Q&A and the Agent all degrade in the packaged app. better-sqlite3's `.node` is loaded through Node's `require` and electron-builder's smartUnpack handles it automatically, so it's unaffected.
2. **The app settings folder gets renamed.** The development build's userData is `~/.config/knowmon` (the `name` in package.json), while the packaged build would become `~/.config/Knowmon` (productName). The last vault, the Ollama settings, and the tab and theme preferences (localStorage) would then be lost. User decision: **always use `knowmon`**.
3. **Template settings were never changed:**
   - `description`, `author` (example.com) and `homepage` (electron-vite.org) in `package.json`.
   - `electron-builder.yml`: `linux.maintainer: electronjs.org`, `publish` (auto-updates pointing to example.com; the project doesn't use electron-updater), and the camera/microphone/folder permission descriptions in macOS `extendInfo`.
   - `files` doesn't exclude `docs/`, `test-vault/` and `scripts/`, so they get packaged into the app.
4. **Linux formats** (user decision): deb + AppImage, dropping snap (needs snapcraft, which this machine doesn't have). The deb's after-install script sets up chrome-sandbox and an AppArmor profile (Ubuntu 24+). On Ubuntu 24+, AppArmor blocks the AppImage's sandbox (this machine has `apparmor_restrict_unprivileged_userns = 1`); just record the behavior and document it rather than forcing a fix.
5. **Author information** (user decision): `Richard Lai <richardlaiis@proton.me>`.

The icons are still Electron's defaults (`build/icon.*`, `resources/icon.png`); they're left for the final packaging task and untouched this time.

## Steps

### 0. Housekeeping and saving

- Delete the memory `image-feature-pending-test.md` and its line in `MEMORY.md` (the user has tested the image feature); also remove `[[image-feature-pending-test]]` from `electron-headless-testing.md`.
- Save this plan as `docs/plans/phase8-packaging.md` (the roadmap convention). Later findings and measurements go in this document.

### 1. Load sqlite-vec from outside the asar

`src/main/db/index.ts`:

- Add and export the pure function `unpackedPath(p: string): string`: it replaces the `app.asar` directory segment of a path with `app.asar.unpacked`, handling both `/` and `\`; paths that are already `app.asar.unpacked` or not in an asar are returned unchanged.
- `loadVectorExtension` becomes `db.loadExtension(unpackedPath(sqliteVec.getLoadablePath()))`, keeping the `console.warn` and fallback on failure. In development and tests the path has no `app.asar`, so behavior is exactly the same.
- Tests in `src/main/db/vectors.test.ts`: a Linux path, a Windows backslash path, an already unpacked path, a path outside an asar, and a file name that happens to contain `app.asar` without it being a directory segment.

`electron-builder.yml`: add `node_modules/sqlite-vec-*/**` to `asarUnpack`.

### 2. Fix userData to `knowmon`

`src/main/index.ts`: at the module's top level (before `app.whenReady()`, next to `registerSchemesAsPrivileged`), call `app.setPath('userData', join(app.getPath('appData'), 'knowmon'))`, with a one-line comment explaining why. This is internal main-process behavior and doesn't touch `types.ts` or the IPC contract.

### 3. Clean up the packaging configuration

`package.json`:

- `description`: one sentence describing Knowmon.
- `author`: `Richard Lai <richardlaiis@proton.me>`.
- `homepage`: `https://github.com/richardlaiis/Knowmon`.

`electron-builder.yml`:

- Add exclusions to `files`: `!{docs,test-vault,scripts}/**`, `!{CLAUDE.md,vitest.config.ts}`.
- `linux.target` becomes `AppImage` and `deb`; `linux.maintainer` becomes the author information; `linux.category` becomes `Office`.
- Remove the `publish` block (no auto-updates).
- Remove the unused permission descriptions from `mac.extendInfo`.

### 4. Build and inspect the contents

- `npm run build:linux` produces `dist/knowmon-1.0.0.AppImage`, `dist/knowmon_1.0.0_amd64.deb` and `dist/linux-unpacked/`.
- Use `npx asar list dist/linux-unpacked/resources/app.asar` to confirm:
  - No `docs`, `test-vault`, `scripts` or `src`.
  - `app.asar.unpacked/` contains `node_modules/sqlite-vec-linux-x64/vec0.so` and better-sqlite3's `.node`.
- Record the installer sizes. better-sqlite3 brings prebuilds for 8 platforms (about 17 MB); just record it, without optimizing this time.

### 5. Automatically verify the packaged asar layout

Following the memory `electron-headless-testing`: use a wrapper main.js in the scratchpad that runs the packaged `dist/linux-unpacked/resources/app.asar/out/main/index.js` with `node_modules/electron`. The wrapper does three things:

- Hides the window.
- Stubs `dialog.showOpenDialog` to return a copy of test-vault under the home directory (not `/tmp`).
- Opens `--remote-debugging-port`.

Open the vault over CDP, then confirm:

- `window.api.llm.status()` has no `sqlite-vec failed to load` error.
- With Ollama running, after embedding finishes, `sqlite3 <vault>/.knowmon/index.db "select count(*) from vec_chunks"` is greater than 0.
- Hybrid search for `培養好習慣的方法` returns `vector: true`, with results labeled meaning.
- The `knowmon-asset://` image protocol can read images in `attachments/`.
- userData is at `~/.config/knowmon` (if the wrapper uses its own `--user-data-dir`, check the path logic built from `app.getPath('appData')` instead).

This step only verifies the asar/unpacked layout and the path conversion; the real installation flow is tested manually in the next step.

### 6. Manual testing by the user (needs sudo, run by the user)

1. `! sudo apt install ./dist/knowmon_1.0.0_amd64.deb`
2. Open Knowmon from the application menu and confirm it starts without `--no-sandbox`.
3. After opening a vault, all of these must work:
   - AI ready appears in the sidebar.
   - Hybrid search has meaning results.
   - Semantic edges in the graph, Q&A, the Agent.
   - Pasting and showing images.
   - Deleting a note sends it to the trash.
4. Confirm the last vault location, theme and tabs carry over from the development build (since userData is the same).
5. `chmod +x dist/knowmon-1.0.0.AppImage && ./dist/knowmon-1.0.0.AppImage`: record whether the sandbox blocks it, then try `--no-sandbox`.
6. `sudo apt remove knowmon` removes it cleanly.

### 7. Documentation

- `docs/plans/phase8-packaging.md`: record findings, installer sizes and the AppImage's actual behavior.
- "Development environment notes" in `docs/architecture.md`: rewrite "when packaging, make sure sqlite-vec isn't packed into the asar" as the current approach (`asarUnpack` + `unpackedPath`), and add that userData is fixed to `knowmon`.
- "Building installers yourself" in the user guide's `installation.md` (Chinese and English): update to deb and AppImage, drop snap, drop the "vector search may not work" warning (verified on Linux; Windows and macOS are still marked unverified), and add that the AppImage needs `--no-sandbox` on Ubuntu 24+ (depending on step 6's results). Update "Building installers" in the README to match.
- **Don't check off** "produce installers" in the roadmap yet; wait until the final packaging task (three platforms, icons, version) is done.

## Out of scope this time

- Final icons, version number, code signing, Windows and macOS packaging (they need their own operating systems or CI), left for the final packaging task.
- Shipping only the target platform's better-sqlite3 prebuild (slimming down).
- The settings page and performance work.

## Verification

- `npx vitest run`, `npm run typecheck` and `npm run lint` all pass (including the new `unpackedPath` tests and the existing `vectors.test.ts`).
- `npm run dev` still starts normally and reads the settings in `~/.config/knowmon`.
- The asar content check in step 4 and the automated verification in step 5 pass.
- The user completes the manual test checklist in step 6.

## Results (2026-10-20)

### Differences from the plan

- macOS's `NSDocumentsFolderUsageDescription` and `NSDownloadsFolderUsageDescription` were **kept** with rewritten descriptions: vaults often live in those two folders, and macOS asks for a usage description when accessing them. Only the camera and microphone ones were removed.
- On the first build, electron-builder inferred GitHub from the git remote and generated `app-update.yml` and `latest-linux.yml`, so `publish: null` is now set explicitly.
- The build warned about a missing `desktopName` (under Wayland the window can't be matched to its `.desktop` file, so the dock shows a generic icon), so `"desktopName": "knowmon.desktop"` was added to `package.json` along with `linux.syncDesktopName: true`.

### Build

`npm run build:linux` (electron-builder 26.15.3, Electron 39.8.10):

| File                           | Size                           |
| ------------------------------ | ------------------------------ |
| `dist/knowmon-1.0.0.AppImage`  | 131 MB                         |
| `dist/knowmon_1.0.0_amd64.deb` | 103 MB (328 MB when installed) |

- The asar contains no `docs`, `test-vault`, `scripts` or `src`.
- `app.asar.unpacked/` contains `node_modules/sqlite-vec-linux-x64/vec0.so`. better-sqlite3 is unpacked whole by smartUnpack, including prebuilds for 8 platforms (17 MB) and its C sources; it can be slimmed down later.
- The deb's `postinst` sets up chrome-sandbox and installs an AppArmor profile on Ubuntu 24+.
- The renderer's main bundle is about 3 MB (worth another look in the performance task).

### Automated verification (step 5)

Ran the wrapper with `node_modules/electron`, loading `dist/linux-unpacked/resources/app.asar/out/main/index.js` (with `XDG_CONFIG_HOME` pointing to the scratchpad so the real settings aren't touched), and opened a copy of test-vault over CDP:

| Check                                                   | Result                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| userData                                                | `<XDG_CONFIG_HOME>/knowmon` ✓                                             |
| `llm.status()`                                          | online, no errors, 9/9 notes embedded ✓                                   |
| Hybrid retrieval for 「培養好習慣的方法」               | `vector: true`; the top three, 原子習慣, 深度工作 and 歡迎, have vector ✓ |
| Semantic edges in the graph                             | 9 ✓                                                                       |
| `<img src="knowmon-asset://vault/attachments/pic.png">` | Loads at 512×512 ✓                                                        |

(Reading `knowmon-asset:` with `fetch` in the renderer is blocked by the CSP, which is expected: the CSP only allows this protocol in `img-src`.)

### AppImage and FUSE

Running the AppImage, the user got `dlopen(): error loading libfuse.so.2 … AppImages require FUSE to run`: electron-builder's default old AppImage runtime needs FUSE 2, while Ubuntu ships only FUSE 3 by default after 22.04 (as does this machine's Ubuntu 26.04).

- Switched to `toolsets.appimage: '1.0.3'` (static runtime 20251108, a beta option in electron-builder 26), which doesn't need libfuse2. The AppImage became 122 MB (zstd compression).
- The new runtime's AppRun checks user namespaces with `unshare -Ur true` and adds `--no-sandbox` automatically when that fails. `unshare` fails on this machine (`apparmor_restrict_unprivileged_userns = 1`), so on Ubuntu 24+ the AppImage runs without a sandbox; the old runtime always added `--no-sandbox`. The deb is unaffected (its postinst installs an AppArmor profile), so the deb is recommended on Debian/Ubuntu.
- Tested: `timeout 12 ./dist/knowmon-1.0.0.AppImage` ran until the timeout (exit 124), with only a harmless libva warning.

### Manual testing (step 6, by the user, 2026-10-20)

- deb: after `sudo apt install`, it opens from the application menu without `--no-sandbox`; AI, Hybrid search, Semantic edges, Q&A, the Agent, images, the trash and carrying over the development settings all work.
- AppImage (static runtime): doesn't need libfuse2 and opens directly.
- `sudo apt remove knowmon` removes it, with a short pause. postrm only removes the `/usr/bin/knowmon` link and unloads the profile with `apparmor_parser --remove`; the pause is probably mostly from deleting about 330 MB of files and apt's triggers (desktop menu, icon cache). That's normal for an Electron app and not worth addressing.
