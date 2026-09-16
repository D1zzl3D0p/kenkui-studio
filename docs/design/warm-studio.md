# Kenkui Studio — Warm Studio

Implemented in `feat/warm-studio`, with the companion server branch `feat/studio-covers`. September 16, 2026. This replaces the production application shell; the original prototype remains separate.

## Design language

A practical ebook-to-audiobook tool with a quick default path and Advanced disclosures. Cocoa dark and linen light themes use the same warm gold family; pale gold buttons have dark text, and links use a darker accent in light mode. Device preference is the default. Theme transitions and audio-driven waveform movement respect reduced motion.

Covers stay large and uncropped. Details sit alongside on wide displays and below on portrait displays. The library combines unfinished drafts and actual server jobs in a cover grid: contrasting opaque badges on the cover, one title line below, tap for actions. Typography uses system sans-serif for controls and a serif fallback cover.

## Implemented flow

1. Upload an EPUB through the actual asset API and inspect its metadata and stable chapter IDs.
2. Edit title/author, upload a PNG/JPEG cover, and optionally select chapters.
3. Choose single narrator or full cast when supported by server capabilities. Both share narrator selection. Full cast exposes fallback voice, assignment method and allowed analysis models. The server discovers characters during conversion; there is no invented character list.
4. Review choices, compare the existing recorded example scenes, and confirm the server's credit estimate.
5. Follow actual job events, reconnect after interruption, request cancellation, and download completed M4B through the web/native Host abstraction.

Voice auditions exist only inside the searchable picker. The waveform reads audio frequency data rather than running an unrelated animation. Changing the example-scene mode preserves relative playback position. Samples explicitly identify themselves as recordings, not the user's book or selected cast.

Drafts persist locally under a server-and-account-specific key. They can be resumed on the same device as long as the server still retains their source. Server jobs retain authoritative title, author, source and narration metadata for the library. No cross-device draft synchronization is promised.

## Billing

Quotes come exclusively from `/v1/jobs/preflight`, debounced when settings change. Stale results are ignored; creation is disabled while the current quote is missing or funds are insufficient. Submission refreshes the quote and asks for another confirmation if the estimate changed. Unchanged requests preserve their idempotency key on retries.

Credit-mode servers expose balance and 500/1,000/2,000-credit Stripe checkout. The current server uses 100 credits per USD and a 50% full-cast premium before rounding. Chapter selection changes billable speech length; voice, cover and metadata do not add a surcharge. Local unmetered servers do not fetch billing. Catalog and recorded scene previews are free.

## Companion API changes

- Advertise `covers.read`, `covers.upload` and upload limit in capabilities.
- Read an owned source cover through authenticated `/v1/assets/{id}/cover`.
- POST PNG/JPEG to that route to create a new owned EPUB asset. Existing drafts/jobs retain their original source. Chapter IDs and content remain stable.
- Bound ZIP expansion and reject unsafe resource paths, encrypted archives and XML entities.
- Include source, source-cover preference, metadata and narration mode in job responses.
- Use a sanitized book title for audiobook download filenames.
- Return inspected speech-character counts for chapters.

Servers without cover capabilities hide cover controls and use local records when job metadata is absent. Authenticated servers must expose `/v1/auth/session`; the companion branch adds it for bearer authentication as well as browser sessions. The server branch is required for the complete experience.

## Remaining product/API decisions

- Source/output retention, remote deletion and cross-device drafts.
- Pre-render character discovery/editing and personalized preview generation/quoting.
- Marketing pricing: `kenkui-site` still advertises flat 1/3-credit books and $1 per credit. Coordinate that copy with the server before release.

## Verification and boundaries

54 Studio unit tests cover request payloads, retry idempotency, account isolation, stale quotes, changed prices, insufficient funds, job cancellation/download and foreground recovery. Browser tests run against the real local API in deterministic fixture mode: EPUB + cover upload, draft reload, completion/download, mobile themes, and real sample-audio waveform activity. The server suite passes 138 tests, with six skipped for unavailable PostgreSQL/provisioned TTS. Coverage includes ownership, immutable source replacement, bearer identity and archive validation.

The web and native frontend builds are checked. This does not test a packaged desktop application, live Stripe payment, production PostgreSQL, or paid TTS inference. Browser fixture downloads validate delivery, not synthesis quality.

## Worktree handoff

Worktrees:

- `/home/dizzler/Projects/Worktrees/kenkui-studio-warm-studio`
- `/home/dizzler/Projects/Worktrees/kenkui-server-warm-studio`

Original working directories were left intact. Snapshot commits `0a60be0` (Studio) and `2f5d572` (server) preserve the uncommitted billing/casting work used as prerequisites. Review the implementation commits after those snapshots; integrate prerequisite work deliberately rather than blindly cherry-picking everything.

From Studio, use `KENKUI_SERVER_ROOT=../kenkui-server-warm-studio npm run check:api`. The same variable supports `generate:api` and `test:e2e`. Set `KENKUI_SERVER_PYTHON` if the Python environment lives elsewhere. `KENKUI_DEV_API_ORIGIN` overrides the Vite development proxy (default `http://127.0.0.1:8000`).

On this headless host, Playwright additionally needs `LD_LIBRARY_PATH=/tmp/kenkui-browser-libs/usr/lib`. The worktree's `node_modules` symlink reuses the existing install; it is not committed. The server can run from the original venv with `PYTHONPATH=src`. Its sibling `kenkui` symlink supplies the editable library for lockfile resolution.

## Local review server

The isolated implementation is available at `http://192.168.84.5:5175/` while the development processes remain running. Port 5175 proxies to the deterministic fixture API on loopback port 4175. It supports actual EPUB/cover parsing, draft recovery and job delivery, but produces fixture audio, has one registered sample voice, and does not charge or call TTS. The original prototype on port 5174 is unchanged.
