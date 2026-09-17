# Native development

Studio uses the same React UI for web and Tauri. Native builds use `@host` to
select the Rust-backed transport and native server registry. Conversion still
runs on a separately running `kenkui-server`.

## Desktop

### Build on macOS

Run these commands on your Mac from this repository, including the current native
changes. Install and launch Xcode once (also needed for iOS later), then select it:

```sh
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
xcodebuild -version
mise trust
mise install node rust
mise exec -- npm ci
mise exec -- npm run macos:build
```

This builds the native frontend, Rust application, `.app` and `.dmg` for the Mac's
architecture. Android SDK packages and Java are not needed for Apple builds.
With the default Cargo output directory, find the application at
`src-tauri/target/release/bundle/macos/Kenkui Studio.app` and the installer under
`src-tauri/target/release/bundle/dmg/`. Launch it with:

```sh
open "src-tauri/target/release/bundle/macos/Kenkui Studio.app"
```

For development use `mise exec -- npm run desktop:dev`. For an app bundle without
a disk image use `mise exec -- npm run desktop:build -- --bundles app`.
`npm run build:native` alone only builds the frontend, not the macOS application.

To build one application supporting both Apple Silicon and Intel:

```sh
mise exec -- rustup target add aarch64-apple-darwin x86_64-apple-darwin
mise exec -- npm run macos:build -- --target universal-apple-darwin
```

Universal bundles go under `src-tauri/target/universal-apple-darwin/release/bundle/`.
These are local build instructions; distribution signing and notarization are not
configured here. See [Tauri's macOS bundling guide](https://v2.tauri.app/distribute/macos-application-bundle/)
and [signing guide](https://v2.tauri.app/distribute/sign/macos/).
macOS compilation and launch still need verification on a Mac.

### Other desktop commands

Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for your OS, including Rust and the platform WebView/build dependencies. Use a
current stable Rust toolchain with the checked-in Cargo lockfile.

```sh
npm ci
npm run tauri info
npm run tauri dev
```

On first launch, choose a server. For the first native acceptance run, start an
unauthenticated local `kenkui-server` and add its origin, for example
`http://127.0.0.1:7850` if that is the port it is listening on. The probe checks
`/v1/capabilities` and expires after ten seconds. Path prefixes, URL credentials,
query strings and fragments are rejected rather than silently discarded.

The built-in Cloud entry defaults to `https://api.kenkui.fm`. Set
`VITE_KENKUI_NATIVE_API_ORIGIN` when building/running to change it. It is separate
from `VITE_KENKUI_API_ORIGIN`, which configures hosted web builds. Desktop Cloud
sign-in now has a [native authentication flow](native-authentication.md), which
requires the matching server update and an additional registered WorkOS callback.
Local servers with authentication disabled remain useful for the first smoke run.

Native server settings live in the Tauri store's `servers.json`. Selection is
explicitly saved before switching, and stale selections return to the picker.
An initialization failure shows a retry screen. Malformed individual registry
entries are ignored; a damaged store file that the plugin cannot load requires
repair outside the app and is not silently overwritten.

```sh
npm test
npm run test:native
npm run build:web
npm run build:native
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

The two frontend build commands share `dist/`; the last build replaces it.
Tauri's build hook always builds native mode before packaging. Bundle targets
default to those available on the current platform. To build only a macOS app
without its disk image, use `npm run tauri build -- --bundles app`.

The development server uses port 5173 and fails if it is occupied. The native
save dialog grants access to the selected path; the Rust export command checks
that scope without granting JavaScript filesystem write permissions. Canceling the
dialog does not download the artifact. Desktop downloads stream in Rust through
the authenticated HTTP client, with byte progress and cancellation. A temporary
file in the destination directory replaces the chosen file only after successful
completion; failed/cancelled transfers remove the temporary file. Force-quitting
the process can leave a `.kenkui-download-*` temporary file behind. Responses must
be HTTP 200; redirects are refused, and a 60-second network stall fails the transfer
without imposing a total duration limit. Playback still buffers the complete artifact.

The streaming core uses [`NamedTempFile::persist`](https://docs.rs/tempfile/latest/tempfile/struct.NamedTempFile.html#method.persist)
for atomic replacement. The custom download command checks the filesystem scope
granted by the save dialog before starting; audiobook bytes never cross IPC.

## Mobile preparation

See [mobile development](mobile-development.md) for Android/iOS commands, prerequisite
checks and device acceptance. Mobile export/share, native resume events and safe-area
handling are implemented but await native compilation and device testing. Mobile
Cloud authentication, background transfers and iOS project generation remain pending.
The Android project is generated; native Android builds require a supported host.
Streaming playback is optional and is not a mobile release requirement.

## Verification boundary

The Rust auth/HTTP/SSE/download core can now be tested without desktop WebView dependencies
using `mise exec -- npm run test:native`. The project now pins a persistent Rust
toolchain in `mise.toml`; the earlier temporary toolchain cache has been removed. Native shell compilation, real credential/file access and device
execution remain unverified: Linux GLib/GObject/WebView dependencies are missing. Use the
[native smoke checklist](../native-smoke-checklist.md) on a configured machine.
