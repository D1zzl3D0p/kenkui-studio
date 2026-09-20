# Kenkui Studio native smoke checklist

Run against a local `kenkui-server` on `http://127.0.0.1:7850`.
Automated native E2E is deliberately out of scope this milestone (spec §7).

## Foundation follow-up — 2026-09-17

See [native development setup](setup/native-development.md). Frontend checks
cover startup, server persistence, export cancellation and stream close races;
the following native checks still require a configured desktop:

- [ ] Fresh install opens the server picker without requesting a placeholder URL.
- [ ] Server selection survives an immediate reload/restart.
- [ ] Invalid API responses and timed-out server probes leave the registry intact.
- [ ] Canceling the save dialog does not start an artifact download.
- [ ] Saving writes the selected file without a filesystem permission error.
- [ ] Navigating away from a job closes its Rust stream; repeated navigation does
  not accumulate network requests.
- [ ] Server EOF/disconnect triggers a snapshot refresh and reconnect for active jobs.
- [ ] Windows file drag/drop reaches the EPUB upload control.
- [ ] Device HMR can reach Vite through `TAURI_DEV_HOST`.
- [ ] An invited Cloud account signs in through the system browser and returns
  to Studio; a non-invited account remains signed out.
- [ ] Canceling or timing out a login closes the callback listener.
- [ ] Relaunch restores native credentials from the OS store without exposing
  them to the WebView; a second instance focuses the existing window.
- [ ] Concurrent API requests and SSE refresh once after access expiry.
- [ ] Switching servers does not attach Cloud credentials to a LAN server.
- [ ] Sign-out clears native credentials even offline; locked credential storage
  reports an error without falling back to plaintext.
- [ ] The account menu offers notification permission, and the OS prompt appears
  once; a refusal leaves the studio usable.
- [ ] A book finishing while the window is backgrounded raises a system
  notification naming that book.

The implementation environment lacked Rust and Linux WebView dependencies, so
these native checks are not marked as passing.

## Verified 2026-09-12

- [x] The macOS `.app` bundle builds (`npm run tauri build`, aarch64 release).
- [x] The app launches and stays resident.

## Not yet verified — requires an interactive desktop session

The session that built this had no GUI automation or screen-recording
rights, so every item below is untested. **Do not claim them as passing
until a human works through them.**

- [ ] App launches and shows the server picker or the jobs list.
- [ ] Adding `http://127.0.0.1:7850` succeeds and persists across a restart.
- [ ] Adding an unreachable address shows an error and is not persisted.
- [ ] The jobs list renders server state.
- [ ] Creating a job from an EPUB reaches `Status: succeeded`.
- [ ] Progress updates arrive live, proving SSE over the Rust channel works.
- [ ] Killing the server mid-job surfaces an error rather than hanging.
- [ ] "Download M4B" opens a native save dialog and writes a playable file.
- [ ] The window's devtools network panel shows **no** requests: all traffic is in Rust.

## Known environment gaps

- **DMG bundling fails here.** `bundle_dmg.sh` drives Finder over AppleScript
  to lay out the disk image and gets `AppleEvent timed out (-1712)` without an
  interactive session. The `app` target is unaffected, so the `.app` bundle is
  the artifact this milestone produced. Re-run `npm run tauri build` from a
  logged-in desktop session to produce the `.dmg`.
- **Mobile projects are not scaffolded.** `tauri ios init` needs CocoaPods
  (its install wants `sudo`) and `tauri android init` needs an Android SDK;
  neither is present. Per the plan, toolchains were not installed. Mobile
  remains unreleased, and `src-tauri/gen/` stays gitignored until the
  toolchains exist and there are real project files to commit.
- **Platform claims.** macOS is the only platform built or exercised, so it is
  the only one claimed. Windows and Linux are configured but unbuilt.

## Streamed desktop export (2026-09-17)

- [ ] Download a large audiobook: byte progress advances and WebView memory stays bounded.
- [ ] Cancel during a transfer: the temporary file disappears and an existing destination remains intact.
- [ ] Interrupt the connection or fill the disk: an error appears and an existing destination remains intact.
- [ ] Complete a download over an existing file and verify the resulting M4B plays.
- [ ] Cancel the save dialog: no artifact request starts.
- [ ] Cancel while waiting for response headers or leave the job page: the transfer stops.
- [ ] Export with an expired Cloud access credential: native refresh succeeds without exposing tokens to JavaScript.

Automated tests cover the transfer core and IPC lifecycle. Native dialog scopes,
platform filesystem replacement and real desktop execution still need these checks.

## Mobile implementation (2026-09-17)

- [x] Generate the Android project with the mise-managed toolchain.
- [ ] Generate the iOS project on macOS.
- [ ] Compile the Kotlin/Swift export bridge on supported build hosts.
- [ ] Complete the [mobile device acceptance run](setup/mobile-development.md#first-device-acceptance-run).
- [ ] Verify native resume delivery after long suspension and recovery after retry exhaustion.
- [ ] Verify Android FileProvider access and iOS Save to Files, including iPad.
- [ ] Verify safe areas, local-network permission and keyboard/back navigation.

Streaming playback is optional. Mobile Cloud sign-in remains pending.
