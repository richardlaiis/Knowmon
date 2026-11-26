# Phase 8: CI tests and installer releases for three platforms

## Context

Using Knowmon today means installing Node.js and Git, cloning, running `npm install`, and on Linux setting up chrome-sandbox with sudo, which is too high a bar for ordinary users. The goal is for users to download an installer from GitHub Releases and install it directly.

What's been blocking this: sqlite-vec only installs the build for the build machine's platform, so installers must be built on their own operating system (`docs/architecture.md`, "Development environment notes"). The deb and AppImage were only verified on Ubuntu 26.04 (`docs/plans/phase8-packaging.md`); Fedora 44, which the user now uses, hasn't been tested, and there's no rpm.

This time, three steps:

1. Verify on Fedora and add an rpm.
2. GitHub Actions: run the tests on three platforms on every push; on a tag push, build four kinds of installers and upload them to a draft Release.
3. Release Windows and macOS as "experimental" for now, with installation instructions.

User decisions (2026-11-15):

- License: **MIT**.
- The first version is **0.1.0**.
- The repo is **public**.
- macOS supports **Apple Silicon and Intel**.
- Carried over from earlier discussion: the user controls release timing; packaging happens only on a `v*` tag push, producing a **draft** Release that the user checks and publishes manually. No auto-updates (`publish: null` stays).

## Steps

### 0. Save the plan

Save this plan as `docs/plans/release-ci.md`; later findings and results go in this document.

### 1. Packaging configuration and Fedora verification

`electron-builder.yml`:

- Add `rpm` to `linux.target`. electron-builder's default after-install script is shared by deb and rpm and sets chrome-sandbox's SUID bit.
- Change `dmg.artifactName` to `${name}-${version}-${arch}.${ext}`. Otherwise the arm64 and x64 dmgs share a name and overwrite each other in the Release.
- Set `mac.target` explicitly to `dmg`, without a separate zip.

`package.json`: change `version` to `0.1.0`.

Add `LICENSE` (MIT, `Copyright (c) 2026 Richard Lai`), and add `"license": "MIT"` to `package.json`.

Local verification on Fedora (needs sudo, run by the user):

1. `! sudo dnf install rpm-build` (fpm needs `rpmbuild` to build an rpm).
2. Run `npx electron-vite build && npx electron-builder --linux AppImage rpm`. No deb locally, since Fedora may not have the packaging tools for it; the deb is left to CI.
3. First I run the automated verification: reuse the wrapper and CDP approach from phase 8 step 5 against `dist/linux-unpacked/`. With `XDG_CONFIG_HOME` pointing to the scratchpad and a copy of `~/knowmon-test-vault`, confirm:
   - userData is in the right place
   - `llm.status()` has no sqlite-vec error
   - Hybrid search returns `vector: true`
   - Semantic edges exist
   - The image protocol can read images
4. Manual testing by the user:
   - `! sudo dnf install ./dist/knowmon-0.1.0.x86_64.rpm`, open it from the menu, and confirm it doesn't need `--no-sandbox`.
   - Test with the checklist from phase 8 step 6: AI ready, Hybrid, Semantic edges, Q&A, Agent, images, deleting to the trash, settings carried over.
   - AppImage: run it directly and record whether the sandbox is on. Fedora has no AppArmor restriction, so `unshare` should succeed and `--no-sandbox` shouldn't be added automatically.
   - `! sudo dnf remove knowmon` removes it cleanly.
5. If an rpm default dependency (for example `libXScrnSaver`) doesn't exist on Fedora 44 and installation fails, override it in `rpm.depends` and record why.

### 2. CI: tests on three platforms (`.github/workflows/ci.yml`)

- Triggers: pushes to `main` and pull requests.
- Permissions: `permissions: contents: read`. Set `concurrency` so a new push on the same branch cancels the old run.
- Job `check` (`ubuntu-latest`): `npm ci` → `npm run typecheck` → `npm run lint`. These are platform-independent, so they run only on Linux.
- Job `test`, with a matrix of `ubuntu-latest`, `windows-latest` and `macos-latest`: `npm ci` → `npx vitest run`. `ollama.integration.test.ts` is already skipped by default with `skipIf`.
- Shared setup: `actions/setup-node`, Node 24, `cache: npm`. Action versions are pinned to major versions.

Add `.gitattributes` with `* text=auto eol=lf`, marking binary files (png, ico, icns) as `binary`. The reason: git on the Windows runner converts line endings to CRLF by default, which affects Prettier (`endOfLine` defaults to `lf`) and tests that read file contents; the same goes for future contributors on Windows.

The first test runs on Windows and macOS may show never-before-seen failures, such as path separators, case-insensitive file systems, or files locked while a temp directory is deleted:

- **Problems in how tests are written, or very small bugs**: fix them in this task and add tests.
- **Anything needing a change to `types.ts`, the DB schema, or the app's behavior** (for example file name characters Windows doesn't allow): record it first and ask the user whether to split it into another task.

### 3. Releases: packaging on tag push (`.github/workflows/release.yml`)

Triggers:

- `push: tags: ['v*']`: an actual release.
- `workflow_dispatch`: a manual trial run. Installers are only uploaded as workflow artifacts, **with no Release created**, for trying the Windows and macOS builds before releasing.

Job `build`, with a matrix of four (`fail-fast: false`, so one platform failing doesn't stop the others):

| Runner           | Command                                             | Output             |
| ---------------- | --------------------------------------------------- | ------------------ |
| `ubuntu-22.04`   | First `sudo apt-get install -y rpm`, then `--linux` | AppImage, deb, rpm |
| `windows-latest` | `--win`                                             | NSIS `-setup.exe`  |
| `macos-latest`   | `--mac`                                             | `-arm64.dmg`       |
| `macos-15-intel` | `--mac`                                             | `-x64.dmg`         |

- Linux packages on the older 22.04, so the app is less likely to fail on older distributions because of too new a glibc.
- Each job's steps: `npm ci` → `npx vitest run` (no packaging if tests fail) → `npx electron-vite build` → `npx electron-builder <platform> --publish never`.
- Upload the installers in `dist/` with `actions/upload-artifact`.
- On a tag push, first check that `${GITHUB_REF_NAME#v}` equals the `version` in `package.json`, failing otherwise, so files with the wrong version number are never built.
- macOS sets `CSC_IDENTITY_AUTO_DISCOVERY=false` so it doesn't try to sign with the keychain. Apple Silicon apps need at least an ad-hoc signature to run, so check the result with `codesign -dv` in the log. If it's unsigned, set `identity: '-'` in the `mac` configuration.

Job `release`, only on tag pushes, after all four builds finish:

- Permissions: `permissions: contents: write`.
- Collect all installers with `actions/download-artifact`.
- Run `gh release create "$GITHUB_REF_NAME" --draft --generate-notes <files>`, using the runner's built-in `gh` and `GITHUB_TOKEN`, so no new secrets are needed.

electron-builder's `--publish` is **not** used this time, because it needs a `publish` configuration and also generates auto-update metadata such as `latest*.yml`, which conflicts with the `publish: null` decision.

### 4. Documentation

- Add `docs/releasing.md` for maintainers:
  - The release process: bump the version → commit → `git tag vX.Y.Z && git push origin vX.Y.Z` → check the draft → Publish.
  - How to do a trial build with `workflow_dispatch`.
  - What to do on failure: delete the draft and the tag, fix, and tag again.
- `installation.md` (Chinese and English):
  - Add "Download an installer" at the top: download from Releases and pick the format for your platform.
    - Linux: deb for Debian/Ubuntu, rpm for Fedora/RHEL/openSUSE, AppImage for other distributions.
    - Windows: SmartScreen warns; click "More info → Run anyway". Marked experimental.
    - macOS: choose arm64 or x64 by chip. Without notarization the app shows as "damaged" or is blocked by Gatekeeper; clear it with `xattr -cr /Applications/Knowmon.app`. Marked experimental.
  - "Run from source" becomes the second option, for developers.
  - Add rpm to "Building installers yourself".
  - Add how to update an installed version to "Updating": download the new version and install over it.
  - With the version now 0.1.0, update file names such as `knowmon_1.0.0_amd64.deb` in the docs.
- `README.md`:
  - The first line of "Quick start" becomes "download an installer from Releases"; the source steps stay for developers.
  - Add `docs/releasing.md` to the "Documentation" table.
  - Add the MIT license.
- `docs/architecture.md`, "Development environment notes":
  - Linux now has three formats: AppImage, deb and rpm.
  - Installers are built by CI on each platform.
  - dmg file names include the arch.
  - `.gitattributes` forces LF.
- `docs/testing.md`: add "Pre-release checks", with the manual test checklist for Fedora and Ubuntu (adapted from phase 8 step 6) and CI being all green.
- `docs/roadmap.md`:
  - Record progress under "produce installers": CI, rpm, LICENSE and the version number are done.
  - Windows and macOS haven't been verified on real machines, so the item **stays unchecked** until someone tests them.
  - Rewrite "final packaging" under "Next steps" as the remaining work: real-machine verification and whether to code sign.

### 5. Push to GitHub and do a trial run (push only with the user's approval)

1. Commit once local vitest, typecheck and lint all pass. The user decides when to push to `main`, triggering `ci.yml`.
2. Trigger `release.yml` manually (`workflow_dispatch`) from the Actions page, and confirm all four platforms build, the file names are right, and macOS has an ad-hoc signature; download the artifacts and check the file sizes.
3. Once everything checks out, the user pushes the `v0.1.0` tag, checks the draft on the Releases page and publishes it.

## Out of scope this time

- Code signing and notarization: the Apple Developer Program, a Windows certificate.
- Auto-updates or in-app new-version notices. Doing that later adds IPC, which means changing `types.ts`.
- Handling characters Windows forbids in file names (`: * ? " < > |`, reserved names such as `CON`) and renames on case-insensitive file systems: if CI finds problems, open a separate task.
- Linux arm64, Flathub or an apt repository.
- Keeping only the target platform's better-sqlite3 prebuild (slimming down).
- A first-run walkthrough (downloading models or opening the sample vault from inside the app).

## Known risks

- The user previously installed the 1.0.0 deb on Ubuntu, and apt treats 0.1.0 as a downgrade. They need to `sudo apt remove knowmon` before installing; mention this in the release notes and `docs/releasing.md`.
- The `macos-15-intel` runner is scheduled for retirement in August 2027, after which the Intel build must be cross-built on the arm64 runner or dropped. Recorded in `docs/releasing.md`.
- `toolsets.appimage` is still a beta option in electron-builder; confirm it still works in CI builds.

## Verification

- Local: `npx vitest run`, `npm run typecheck` and `npm run lint` all pass.
- Fedora: step 1's automated verification and the user's manual tests of the rpm and AppImage all pass.
- GitHub:
  - `ci.yml` is green on all three platforms.
  - `release.yml` via `workflow_dispatch` produces six files: AppImage, deb, rpm, `-setup.exe`, `-arm64.dmg` and `-x64.dmg`.
  - Pushing `v0.1.0` creates a draft Release with those six files.
  - Pushing a mismatched tag on purpose (for example `v9.9.9` on a fork or test branch) makes the version check fail the workflow.

## Results (2026-11-17)

### Differences from the plan

- macOS signing wasn't left to the CI log: `mac.identity: '-'` is set directly. Reading the electron-builder 26.15.3 source (`MacTargetHelper.findSigningIdentity`), when no certificate is found it just skips signing rather than falling back to ad-hoc; only an explicit identity of `'-'` gives an ad-hoc signature. `hardenedRuntime: false` is also set: with an ad-hoc signature plus the hardened runtime, library validation blocks dylibs without a Team ID (sqlite-vec is loaded with `dlopen`), and electron-builder warns about it. The hardened runtime is only needed for notarization. The "Show macOS code signature" step stays in CI to confirm `Signature=adhoc`.
- `.gitattributes` also marks `*.docx`, `*.pdf`, `*.jpg`, `*.gif` and `*.webp` as `binary` (`Reports/` has docx files). `.editorconfig` was CRLF in the repo and was converted to LF too.
- Action versions: in the end `checkout@v7`, `setup-node@v7`, `upload-artifact@v7` and `download-artifact@v8` (the first version used the previous major; after the first Release showed a deprecation warning about `upload-artifact@v5` using Node 20, they were upgraded; the new versions switch to ESM and add options, which doesn't affect this usage). `merge-multiple: true` merges the four artifacts into one folder.
- The installation guide lists the rpm only for the Fedora/RHEL family, with openSUSE pointed to the AppImage (approved by the user, 2026-11-17): electron-builder's rpm dependencies use Fedora package names (for example `libXScrnSaver`, which openSUSE calls `libXss1`), which may not resolve on openSUSE, and it hasn't been verified.
- `gh release create` gained `--repo "$GITHUB_REPOSITORY"`: the release job has no checkout, so `gh` can't infer the repo from a git remote.

### Fedora 44 locally

- `npx vitest run` (55 files, 489 tests passed, 4 skipped), `npm run typecheck` and `npm run lint` pass.
- The rpm's default dependencies (`gtk3`, `libnotify`, `nss`, `libXScrnSaver`, `libXtst`, `xdg-utils`, `at-spi2-core`, `libuuid`) all exist on Fedora 44 and are already installed on this machine, so `rpm.depends` didn't need overriding.
- `npx electron-builder --linux AppImage` succeeds: `dist/knowmon-0.1.0.AppImage`, 122 MB.
- Automated verification (the asar in `dist/linux-unpacked/`, wrapper + CDP, `XDG_CONFIG_HOME` pointing to the scratchpad, a copy of `~/knowmon-test-vault`, embedModel `bge-m3`, chatModel changed to `qwen3.5:2b`, which this machine has):

| Check                                       | Result                                                          |
| ------------------------------------------- | --------------------------------------------------------------- |
| userData                                    | `<XDG_CONFIG_HOME>/knowmon` ✓                                   |
| `llm.status()`                              | online, no sqlite-vec error, 9/9 notes embedded ✓               |
| Hybrid retrieval for 「培養好習慣的方法」   | `vector: true`; the top three are 原子習慣, 深度工作 and 歡迎 ✓ |
| Graph edges                                 | wikilink 15, semantic 9, sequence 4 ✓                           |
| `knowmon-asset://vault/attachments/pic.png` | Loads at 1024×1024 ✓                                            |

- rpm packaging (2026-11-17):
  - With only `rpm-build` installed it fails: the fpm that electron-builder downloads bundles Ruby, which needs `libcrypt.so.1`, while Fedora has only `libcrypt.so.2` by default (exit 127). It succeeds after installing `libxcrypt-compat`, which is now in "Building installers yourself" in the installation guide. CI packages on Ubuntu and is unaffected.
  - `dist/knowmon-0.1.0.x86_64.rpm` is 90 MB (344 MB installed), License MIT, with the default dependency list above.
  - It contains `app.asar.unpacked/node_modules/sqlite-vec-linux-x64/vec0.so`; the `.desktop` file has `Exec=/opt/Knowmon/knowmon %U` (an absolute path).
  - The after-install script sets chrome-sandbox to `0755` when user namespaces are available (using the namespace sandbox) and to SUID `4755` only when they aren't. The plan's "sets SUID" was imprecise; on Fedora the former is expected.
  - A possible problem (not yet verified): the after-remove script doesn't check rpm's `$1`, so on upgrade the old version's postun runs after the new version is installed and may remove `update-alternatives`' `/usr/bin/knowmon`. The menu uses an absolute path and is unaffected; only the `knowmon` command in a terminal would be. Check this on the first upgrade (0.1.0 → the next version).
- Manual testing by the user (2026-11-17): after installing the rpm with `sudo dnf install`, tested per step 1 point 4 and reported it passing.
  - Fedora 44 has no AppArmor, so `unshare -Ur true` succeeds and the AppImage's AppRun doesn't add `--no-sandbox`; it runs sandboxed (as expected).
  - `sudo dnf remove knowmon`: `/usr/bin/knowmon`, `/etc/alternatives/knowmon` and the `.desktop` file are removed and `~/.config/knowmon` is kept ✓. But `/opt/Knowmon` is left as a tree of **empty folders** (0 files): when fpm builds the rpm it lists only files in `%files` and doesn't own the folders, so rpm doesn't delete them on removal. This doesn't affect use or reinstalling; `rpm.fpm: ['--directories', '/opt/Knowmon']` would make the package own the whole folder, but whether to change it hasn't been decided.

### GitHub

- First push (`4db342c`, 2026-11-17): all four `ci.yml` jobs passed in about 3 minutes (check 1:23, Ubuntu 1:07, macOS 2:02, Windows 2:55). vitest passed on the first run on Windows and macOS, so no tests needed fixing.
- First manual `release.yml` run: `macos-latest` failed in `electron-vite build` with `"Markdown" is not exported by "src/renderer/chat/markdown.ts"`. `src/renderer/chat/` had both the `Markdown.tsx` component and the `markdown.ts` parser, and since macOS is case-insensitive by default, `import './Markdown'` resolved to `markdown.ts` (Windows would too). CI didn't catch it because vitest only imports the parser and never runs the vite build. The user cancelled the run. Fixes:
  - The parser was renamed to `parseMarkdown.ts` (its test too).
  - Added `scripts/case-collisions.test.mjs`: it walks the repo recursively (skipping dot entries, `node_modules`, `out` and `dist`) and fails when names in the same folder differ only in case after removing the extension, so it catches this on Linux too.
  - The three-platform test job in `ci.yml` now also runs `npx electron-vite build` (a change from the plan, which only ran vitest).
- In the same run, `windows-latest` and `macos-15-intel` failed in vitest, both on performance test time limits: on the Intel Mac `vectors.test.ts` took 4835 ms (limit 1500), `time.test.ts` 3063 ms (500) and `graph.test.ts` 387 ms (200); on Windows `time.test.ts` took 579 ms (500). The same test happened to pass on `windows-latest` in CI; shared machines vary in speed. Fix: added `perfBudget` (`src/main/db/test-utils.ts`), which keeps the original design targets locally and relaxes them 10× when the `CI` environment variable is set (the Intel Mac is up to about 6× slower); order-of-magnitude regressions are still caught. The 8-second limit in `forceLayout.test.ts` was already generous and wasn't changed.
- Third Release run (`8c54dea`): Windows, Ubuntu and macOS arm64 succeeded; on `macos-15-intel`, `vectors.test.ts` and `time.test.ts` hit vitest's default 5-second per-test timeout (which includes preparing 1000 notes, not just the measured part). `testTimeout` in `vitest.config.ts` becomes 60 seconds when `CI` is set.
- Fourth Release run (`19d0395`, workflow_dispatch): all four platforms succeeded in about 6 minutes 20 seconds (the Intel Mac being slowest). Artifacts: `knowmon-linux` 314 MB, `knowmon-windows` 106 MB, `knowmon-mac-arm64` 124 MB, `knowmon-mac-x64` 133 MB. For the user to confirm: the file names inside the artifacts, and `Signature=adhoc` in both macOS jobs.
- Pushed the `v0.1.0` tag (2026-11-17): the version check passed, and all four builds and the release job succeeded (about 5 minutes), creating a draft Release (drafts aren't visible to the unauthenticated API; the user checks it on the Releases page and publishes it).
