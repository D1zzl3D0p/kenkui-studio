# Native CI builds

The `Native builds` GitHub Actions workflow runs on pull requests, pushes to
`main`, and manual dispatch. It first runs frontend tests, both frontend builds,
and locked Rust core tests. Successful checks unlock independent native jobs;
one platform failure does not cancel the others.

## Download a test build

1. Push the workflow and application changes to GitHub and open a pull request,
   or use **Actions → Native builds → Run workflow** after the workflow is on the
   default branch.
2. Open the run for the commit you want to test. Check the relevant platform job
   succeeded, then download its artifact at the bottom of the run page.
3. Extract the Actions artifact ZIP. Artifacts include the commit SHA in their
   names and are retained for 14 days. Record that SHA with test results.

| Artifact | Contents and use |
| --- | --- |
| `macos-arm64` | Ad-hoc signed `.app.zip` for Apple Silicon. Extract the inner ZIP to preserve the app bundle. |
| `macos-x64` | Equivalent app for Intel Macs; compiled on the ARM Mac runner. |
| `windows-x64` | Unsigned NSIS `.exe` installer for 64-bit Windows. |
| `linux-x64` | Ubuntu 22.04-built `.deb` and AppImage. Set the extracted AppImage executable with `chmod +x`. |
| `android-debug` | Debug-signed APK containing ARM64 and x64, for phones and emulators. Install with `adb install path/to/app.apk`. |
| `ios-simulator-arm64` | App ZIP for an Apple Silicon iOS simulator. Boot a compatible simulator, extract the app and use `xcrun simctl install booted /path/to/App.app`. |

These builds need no repository signing secrets and do not publish GitHub
releases or upload to app stores. macOS builds are not notarized, and Windows
builds have no publisher signature, so OS trust prompts are expected. Android
uses a fresh runner's debug key: subsequent runs may require uninstalling the
previous app, which deletes its local settings. A persistent beta signing key
is a separate distribution task.

The iOS job generates the project on its Mac runner while `src-tauri/gen/apple`
is absent. Once a reviewed project is committed, CI uses it instead. The
simulator artifact cannot be installed on an iPhone or submitted to TestFlight;
those require device builds, an Apple signing team and provisioning.

## Build scope

Node and Rust versions in the workflow match `mise.toml`; update them together.
Android uses Java 21, SDK 36, Build-Tools 36.0.0 and NDK 30.0.16248370. Desktop
builds use explicit target triples and package formats. Cargo builds use the
checked-in lockfile, and npm installs use `npm ci`.

The Android debug APK embeds the native frontend; it does not need a running
Vite server. Its existing debug manifest permits cleartext LAN connections.
Release Android builds have a different network policy and still need testing.
macOS uses app archives initially to avoid Finder-dependent DMG creation in CI.
Linux ARM64 and Windows ARM64 are not included in this first matrix.

`npm run check:api` needs the sibling `kenkui-server` schema checkout and is not
part of this standalone workflow. Browser E2E and native UI automation are also
outside this initial build workflow. Compilation does not prove interactive
behavior; use the manual acceptance checks below.

## First acceptance run

Use a separately running, unauthenticated Kenkui server for the first pass.
Phones must use its reachable LAN address, not `localhost`. Mobile Cloud login
is not implemented yet. Verify network policy and iOS local-network permission
on actual devices when device builds become available.

- Fresh launch, server selection and persistence after restart.
- EPUB selection (and desktop drag/drop), job creation and live progress.
- Recovery after server disconnect and, on mobile, background/resume.
- Large M4B export, cancellation, low-storage errors and playable output.
- Native save/share dialogs, mobile keyboard, safe areas and back navigation.
- Desktop Cloud login, restored credentials, refresh and sign-out in a separate
  pass against a server configured for native authentication.

Record OS/version, architecture, commit SHA and pass/fail evidence in the
[native smoke checklist](../native-smoke-checklist.md). The workflow's first
successful hosted runs and device checks remain necessary before claiming any
new platform support.

See [Tauri's GitHub build guide](https://v2.tauri.app/distribute/pipelines/github/)
and [CLI reference](https://v2.tauri.app/reference/cli/) for the underlying build
commands.
