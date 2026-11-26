# Releasing a new version

For maintainers: GitHub Actions builds the installers for four platforms and creates a Release. For where the plan and decisions came from, see [`plans/release-ci.md`](plans/release-ci.md).

## Workflows

| File                            | Trigger                    | What it does                                                                                                |
| ------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`      | Push to `main`, PRs        | Typecheck and lint on Linux; vitest once each on Linux, Windows and macOS                                   |
| `.github/workflows/release.yml` | Pushing a `v*` tag         | Tests and packages on all four platforms; when all succeed, creates a **draft** Release with six installers |
| `.github/workflows/release.yml` | Manual (workflow_dispatch) | Packages only; installers are uploaded as workflow artifacts and no Release is created                      |

Packaged platforms:

| Runner           | Output                                                                          |
| ---------------- | ------------------------------------------------------------------------------- |
| `ubuntu-22.04`   | `knowmon-X.Y.Z.AppImage`, `knowmon_X.Y.Z_amd64.deb`, `knowmon-X.Y.Z.x86_64.rpm` |
| `windows-latest` | `knowmon-X.Y.Z-setup.exe`                                                       |
| `macos-latest`   | `knowmon-X.Y.Z-arm64.dmg`                                                       |
| `macos-15-intel` | `knowmon-X.Y.Z-x64.dmg`                                                         |

Installers must be built on their own operating system: sqlite-vec only installs the build for the platform it is installed on. There are no automatic updates (`publish: null`) and no code signing: macOS uses an ad-hoc signature, and Windows is unsigned.

## Release steps

1. Make sure CI on main is green, then follow "Pre-release checks" in [`testing.md`](testing.md#pre-release-checks) to try packaging and run the manual tests.
2. Change `version` in `package.json` (for example `0.2.0`), run `npm install --package-lock-only` to sync `package-lock.json`, then commit and push.
3. Push a tag whose version matches `package.json` (with a leading `v`):

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

   If the tag and the `package.json` version don't match, `release.yml` fails before packaging.

4. Wait for the `Release` run in Actions to finish, then open the draft on the GitHub Releases page:
   - Check that all six files are there and their sizes look reasonable (about 100–130 MB each).
   - Edit the generated release notes and add upgrade notes if needed.
   - Click **Publish release**.

## Trial packaging before a release

On GitHub, go to **Actions → Release → Run workflow** and choose the branch to package. When it finishes, download `knowmon-linux`, `knowmon-windows`, `knowmon-mac-arm64` and `knowmon-mac-x64` under **Artifacts** at the bottom of the run page. No Release is created and the version isn't checked.

Both macOS jobs have a "Show macOS code signature" step, which should show `Signature=adhoc`. If it shows `code object is not signed at all`, the app won't run on Apple Silicon; fix that before releasing.

## When something fails

If packaging fails on one platform (`fail-fast: false`, so the other platforms keep running, but no Release is created):

1. Fix the problem, then commit and push to main.
2. Delete the old tag and tag the fixed commit again:

   ```bash
   git push --delete origin v0.2.0
   git tag -d v0.2.0
   git tag v0.2.0
   git push origin v0.2.0
   ```

If the draft Release was already created but has problems, delete the draft on the Releases page, then delete and recreate the tag as above. Users can't see a draft until it is published.

## Notes

- **Downgrading from 1.0.0**: before the first release, self-built installers were version 1.0.0. For anyone who installed one, apt and dnf treat 0.1.0 as a downgrade, so they need to run `sudo apt remove knowmon` (or `sudo dnf remove knowmon`) before installing. The 0.1.0 release notes must say so.
- **Intel Mac runner**: `macos-15-intel` is scheduled to be retired in August 2027. At that point, either cross-build x64 on the arm64 runner (`--mac --x64`; sqlite-vec then needs `sqlite-vec-darwin-x64` installed separately) or drop Intel Mac support.
- **AppImage static runtime**: `toolsets.appimage: '1.0.3'` is still a beta option in electron-builder. After upgrading electron-builder, check that the AppImage still builds and runs.
- **Action versions**: the actions in the workflows are pinned to major versions. Upgrade them when GitHub retires an old Node runtime.
