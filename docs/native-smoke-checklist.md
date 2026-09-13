# Kenkui Studio native smoke checklist

Run against a local `kenkui-server` on `http://127.0.0.1:7850`.
Automated native E2E is deliberately out of scope this milestone (spec §7).

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
