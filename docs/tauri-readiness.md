# Tauri desktop and mobile preparation

Assessment: 2026-09-17, against the current working tree, including existing
uncommitted application changes. This is an implementation backlog, not a claim
that native behavior has passed device testing.

## Implementation progress — September 17

The first foundation changes are implemented:

- Recoverable startup and an explicit first-run server picker; configurable real
  Cloud origin; server URL/API validation and durable selection before reload.
- Stable plugin declarations matching the existing lockfile, mobile entry-point
  annotation, fixed/device-accessible Vite server, explicit IPC/development CSP,
  platform bundle targets and HTML drag/drop configuration.
- Desktop export checks the scope granted by the user's save dialog;
  canceling the dialog no longer fetches the audiobook.
- Shared Rust HTTP client, bounded request/probe duration, HTTP URL validation,
  bodyless Response handling and fetch-compatible transport errors.
- Native stream IDs/cancellation, disconnect signaling, HTTP/content-type
  validation and bounded parsing across UTF-8 and line-ending chunk boundaries.

Desktop authentication now also has a Rust-owned PKCE browser flow, origin-scoped
OS credential storage, serialized refresh, authenticated HTTP/SSE and native
sign-out, with companion server endpoints. See
[native authentication](setup/native-authentication.md) for the required server
configuration and the live verification boundary. Mobile authentication remains
pending. The core Rust code is now testable without compiling the WebView shell.

The initial foundation passed 104 frontend tests and both frontend bundles. The
four frontend failures in the original assessment below are no longer present
in the current working tree. Desktop artifact downloads now stream in Rust with
progress, cancellation, network stall timeouts and atomic destination replacement.
Transfer bytes never enter JavaScript. Playback still buffers the artifact.
Mobile now has native export/share bridge source, resume-driven stream recovery,
safe-area handling and prerequisite checks. Kotlin/Swift compilation and device
verification remain open, along with iOS project generation, mobile Cloud
authentication and release automation. Streaming playback is optional, not a mobile
release requirement. See [mobile development](setup/mobile-development.md).
The Android project is generated. Mise-managed tools and SDK packages are installed,
but this Linux ARM64 host cannot execute Google's x86-64 Android build binaries.
See [native development](setup/native-development.md) for commands and limits.

The following assessment records the starting state; the progress list above
identifies the portions now implemented.

## Direction

Keep React/Vite and the existing `Host` boundary. The project already has Tauri 2,
separate web/native builds, a Rust HTTP/SSE bridge, server selection, and native
plugins. No frontend rewrite is necessary.

Ship desktop and mobile initially as clients of Kenkui Cloud or a user-selected
server. A bundled local synthesis server is a separate desktop project:
`manageLocalServer` is currently false and no sidecar is included. Packaging
Studio alone does not provide offline conversion.

## Verified baseline

- `npm test`: 66 passed, 4 failed, across 12 test files. All failures are in
  `tests/app.test.tsx`: insufficient-credit blocking, quote invalidation, metadata
  and casting preservation, and returning from billing to a full-cast draft.
  Duplicate text queries are among the failures; distinguish outdated selectors
  from actual behavioral regressions before changing assertions.
- `npm run build:native`: passes TypeScript and Vite bundling. This does not build
  Rust or exercise IPC, capabilities, native file access, or platform WebViews.
- `npm run tauri info`: reports missing Rust/Cargo/rustup, WebKitGTK 4.1 and rsvg2
  in this environment, plus manifest/plugin version mismatches.
- `cargo check --locked --manifest-path src-tauri/Cargo.toml`: cannot run because
  Cargo is absent. Native executables and Rust tests were not verified here.
- The older `native-smoke-checklist.md` records a macOS app build and launch on
  September 12. Its functional checklist remains unchecked. Android/iOS projects
  are absent, and there is no checked-in CI workflow.

## First milestone: a reliable desktop client

| Priority | Finding and evidence | Required work / acceptance |
| --- | --- | --- |
| P0 | `src/host/tauri.ts` defaults to `https://api.kenkui.example`. | Configure a real native Cloud endpoint and make first-run server selection available immediately. Handle missing/corrupt settings in `src/main.tsx` with a recoverable screen instead of failing before React mounts. |
| P0 | Sign-in links, redirects and logout forms in `src/pages/sign-in.tsx`, `src/app.tsx` and `src/components/account-menu.tsx` assume browser cookie sessions. `createHost().transport()` supplies no token; Rust HTTP has no cookie jar; Rust SSE supplies no authentication. | Implement host-owned native login/logout, browser callback handling, secure token persistence, refresh and server-scoped Rust credential attachment for both HTTP and SSE. Agree the native auth contract with `kenkui-server`; PKCE helpers alone are not a working flow. Verify restart, expiry, logout and switching between Cloud and LAN servers. |
| P0 | `saveBlob()` invokes `writeFile`, but `src-tauri/capabilities/default.json` only grants `fs:default`. | Enable the write command with the appropriate user-selected path scope. Verify a real save, cancel and denied destination. The default filesystem set provides app-directory reading, not general file writing. [Tauri filesystem permissions](https://v2.tauri.app/plugin/file-system/#default-permission). |
| P0 | `Cargo.toml` declares four `2.0.0-rc.*` plugins while JS packages are stable. | Normalize declarations to compatible stable versions, run locked Cargo checks and clear the CLI mismatch report. `Cargo.lock` already resolves dialog 2.7.3, fs 2.5.2, os 2.3.2 and store 2.4.4: do not mistake declaration drift for proof that old binaries are installed. |
| P1 | `src-tauri/src/sse.rs` only splits on LF/LF, decodes individual network chunks lossily, does not validate response status/content type, and returns successfully on EOF. JS close only disables a callback. | Add cancellable streams, EOF/error signaling, HTTP validation, CRLF support and decoding across UTF-8 chunk boundaries. Verify navigation closes the request and a server disconnect triggers snapshot recovery and reconnection. |
| P1 | `src-tauri/src/http.rs` buffers responses into `Vec<u8>`; `nativeFetch()` serializes byte arrays; export loads the whole artifact before showing the save dialog. Playback also loads the complete artifact. | Stream large native downloads to a chosen file/cache with cancellation and progress. Keep small JSON/blob requests on the bridge; provide an authenticated local/streaming playback source. Test a realistically large audiobook and memory use. |
| P1 | The HTTP adapter ignores abort signals, creates a client for every request, returns string errors and always reconstructs a Response with a body. | Reuse a configured Rust client, set bounded request behavior, support cancellation and preserve useful error types. Handle bodyless statuses. Verify network errors still work with `createJob()`'s TypeError-based retry and idempotency key. |
| P1 | CSP has no explicit IPC `connect-src`; custom Rust commands accept arbitrary URLs/headers from JS. | Verify and explicitly configure the required IPC origins in release builds. Keep remote services behind Rust; validate allowed schemes and selected-server destinations in Rust, including credential behavior on redirects. [Tauri CSP](https://v2.tauri.app/security/csp/). |
| P1 | `studio.tsx` uses HTML drag/drop; Tauri leaves its own handler enabled. | Either disable native drag/drop for the existing HTML flow or implement native drop through the host. Windows HTML drop requires disabling the Tauri handler. [Window configuration](https://v2.tauri.app/reference/config/#windowconfig). |
| P1 | External legal/attribution links bypass `host.openExternal`; auth navigates the app WebView. | Route external navigation through the host, keep application routes internal, and test checkout return/resume updates. |
| P1 | Server probes only check HTTP success and discard URL path prefixes; empty registries can return no selected server. IPv6 loopback comparison misses bracketed `[::1]`. | Define supported server URL shapes, validate capabilities/version before persisting, normalize loopback correctly, and guarantee a valid fallback/selection screen. Bound probes so an unreachable server cannot strand startup. |

Fix the four existing frontend failures before using the suite as the migration
baseline. Keep tests about quote validity, actual job payloads and credit gating;
scope queries to the active step where repeated hidden content is intentional.

## Second milestone: Android and iOS working builds

1. Add `#[cfg_attr(mobile, tauri::mobile_entry_point)]` to `run()` in
   `src-tauri/src/lib.rs`. The shared library crate is already present.
   [Tauri mobile entry point](https://v2.tauri.app/start/migrate/from-tauri-1/#preparing-for-mobile).
2. Configure Vite's fixed port, `strictPort`, `TAURI_DEV_HOST`, mobile HMR and
   exclusion of Rust build files from watching. Select supported OS/WebView
   versions deliberately; the top-level await in `main.tsx` must be compatible
   with the resulting JS target. [Tauri Vite configuration](https://v2.tauri.app/start/frontend/vite/).
3. Install Android SDK/NDK/JDK and Rust targets; initialize Android. Initialize
   iOS on macOS with Xcode and the required tooling. Adjust `.gitignore` so native
   project source/configuration can be committed while build outputs stay ignored.
   Validate the reqwest/TLS dependency graph on both targets early.
   [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
4. Implement export/share on mobile. Currently `saveToPath` is false and
   `saveArtifact()` always throws after loading the artifact. Use platform document
   export/share semantics and cache cleanup. Treat Android document URIs and iOS
   document providers as platform resources, not ordinary desktop paths.
5. Test EPUB and cover selection through actual mobile document providers. The
   current HTML file inputs may be reusable; replacement is only needed where
   provider access, large uploads or lifecycle behavior require it.
6. Implement native auth callbacks for cold and warm launches and verify their
   matching server contract. Preserve state/PKCE validation and credentials per
   server in native storage.
7. Implement and test foreground recovery. `onResume` currently uses
   `visibilitychange` with a comment deferring mobile integration. Recovery must
   refresh session and job snapshots and re-open stale streams, including streams
   that exhausted retries. Persist sufficient state for process termination.
8. Exercise safe areas, keyboard visibility, Android back navigation, rotation,
   larger text and touch accessibility. Responsive breakpoints already exist;
   explicit safe-area treatment does not. Test preview and audiobook formats on
   each WebView. Define whether background playback/downloads are release scope.
9. Decide whether mobile supports LAN servers. If so, validate platform network
   permissions, HTTP policy and certificate behavior in release builds; a desktop
   localhost address does not identify the user's computer from a phone.

## Third milestone: distribution and release gates

- Replace macOS-only default bundle targets (`app`, `dmg`) with platform-specific
  packaging. Select desktop installers/package formats and Android/iOS outputs.
- Confirm the permanent application identifier, release icons, OS minimums,
  signing identities, provisioning and release version/build-number policy.
- Define mobile billing distribution requirements before exposing the existing
  web checkout in store builds. This needs a dedicated review of the current
  store policies, product and distribution regions; no compliance conclusion is
  made by this code audit.
- Add CI for web and native frontend builds, Rust checks/tests and the supported
  native build matrix. Add platform integration coverage for IPC/auth/export and
  real-device smoke gates for mobile. Browser mocks do not establish native parity.
- Decide desktop update delivery and mobile store release channels. Add useful
  native diagnostics without logging tokens or full authenticated URLs.
- Update README setup commands and the native smoke checklist to reflect verified
  platforms. Preserve the distinction between a frontend build, an app launch and
  an end-to-end conversion/export pass.

The first acceptance slice should be: launch desktop, select a local unauthenticated
server, import an EPUB, create a job, recover live progress after a disconnect,
preview/listen and export a playable audiobook. Follow with authenticated Cloud
parity, then the same flow on Android and iOS with platform export and resume.
