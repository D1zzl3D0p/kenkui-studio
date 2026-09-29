# Kenkui Studio releases

## 10.1.0 (2026-09-29)

- Warm Studio conversion and library experience, including draft persistence,
  chapter selection, hosted multi-voice casting, billing and account controls.
- Native desktop and mobile hosts with PKCE sign-in, artifact downloads,
  server selection, and completion notifications.
- Chapter size estimates, speech preparation settings, configurable pause tiers,
  and a one-second scene pause for new drafts when supported by the server.
- Spoken chapter-title controls and preflight review, gated by the server's
  `spokenChapterTitles` capability. Existing drafts keep titles disabled.
- Restored hosted voice samples and improved signed-out navigation.
- Bounded dependency ranges replace `latest`, using the existing locked versions.

Package, npm lockfile, Rust crate, Rust lockfile, and Tauri application versions
are all 10.1.0. The API protocol remains `/v1`; deploy core/server 10.2.0 before
Studio to enable chapter-title controls.

See [the release review](docs/release-review-2026-09-28.md) for exact commit
inclusion, pending changes, validation, and remaining publication gates.

## 10.0.0

This release replaces the previous-generation implementation with the pipeline
library, shared local/hosted server, and Kenkui Studio architecture.
The literal package/release version is `10.0.0`; the leading `10` is a nod to
binary two and the second generation. The server protocol remains `/v1`.

Previous releases remain available in Git history and tags. Private-beta hosted
service acceptance is separate from publication of the source code.
