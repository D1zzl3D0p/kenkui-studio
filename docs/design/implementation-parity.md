# Current Studio → Warm Studio: implementation mapping

Audited September 16, 2026 against the actual files in `/home/dizzler/Projects/Repos/kenkui-studio`, including uncommitted billing/casting changes, and the separate `deploy-multivoice-studio` branch (`c02279a`).

## Integration result

Every tracked file in the prerequisite snapshots (`0a60be0` for Studio, `2f5d572` for server) still matches its corresponding original checkout file. No newer local implementation was missed. A dry-run application of the implementation patches succeeded against both originals. Studio's existing untracked `docs/design/warm-studio.md` overlaps the new document and needs reconciliation when integrating; the application code has no patch conflicts.

The original directories remain unchanged. Work remains on `feat/warm-studio` and `feat/studio-covers`.

The separate multi-voice branch contains the same casting controls and request behavior represented in the current checkout. Its extra integration assertions cover the model allowlist and casting overrides. Those behaviors are covered in the redesign's tests. That branch has older flat-price billing copy; the current checkout and redesign use the existing length-based server estimates and checkout implementation.

## Feature mapping

| Existing implementation | Redesign equivalent | Verification |
| --- | --- | --- |
| Capability/version discovery | `App` boot and capability-driven controls | Version, app and build-mode tests |
| EPUB selection, upload limit, upload and inspection | New audiobook uploader | Browser upload + real API inspection |
| Chapter selection using stable IDs | Book → Advanced | Request-payload test and browser conversion |
| Narrator selection | Voices → searchable picker | Unit payload and browser audio tests |
| Character narrator, unknown speaker, gendered/random method, model allowlist | Full cast, fallback picker, Advanced settings | Default and overridden model/method/fallback tests |
| Automatic normalization/server voice engine | Same `tts.normalizeText: true` payload | Request-payload test |
| Title, author, source-cover toggle, advertised output format | Book and Create controls | Explicit metadata/cover/format payload test |
| Preflight validity, credit estimate, insufficient-balance blocking | Live estimate on every step, fresh quote on submit | Pricing, stale-result, changed-price and insufficient-credit tests |
| Idempotent job creation | Persisted key retained across unchanged retries | Retry and semantic-change tests |
| Job list, state and stage/count | Cover grid, action menu with stage/count, conversion view | Browser library completion and job-detail test |
| Job ID and terminal stage/count | Conversion details disclosure | Restored during this audit; failed-job regression test |
| Job failure message | Conversion error message | Failed-job regression test |
| SSE progress/reconnect, manual refresh, foreground recovery | Existing event transport + `JobView` | Existing event recovery tests and app foreground test |
| Cancellation restrictions and pending status | Cancel conversion, disabled while pending; absent for terminal jobs | Cancellation and failed-job tests |
| M4B download through web/native Host | Same Host boundary with readable filename | Unit Host assertion and actual browser download |
| Sign-in/out and expired-session recovery | Reused account page, sign-in from boot failure | Expired-session test and unchanged auth/Host tests |
| Native custom server list/add/select | Reused Servers page; reload initializes client for selected server | Existing server tests and offline recovery test |
| Credit balance, three Stripe packs, checkout return/cancel, bounded balance polling | Redesigned Billing page, same API calls | Existing billing tests retained |
| Platform transport, credential isolation, PKCE, channel SSE | Same Host and transport modules | Existing platform/security tests retained |
| `/jobs`, `/jobs/new`, `/jobs/:id`, `/billing`, `/sign-in`, `/servers` | Supported by Studio navigation | Code review plus creation/job/browser paths |

Intentional behavior changes: new conversions default to **single narrator** even when full cast is supported; users explicitly choose full cast. Six setup screens become Book / Voices / Create. Job IDs move to details, covers become the primary library navigation, and completed jobs gain optional browser playback. Local drafts, cover uploads, voice auditions and theme controls are additions.

Neither the old app nor this redesign offers editable pre-render character rosters or personalized book-text previews. Recorded scene examples do not claim to provide those features.

## Exact server implementation scope

The implementation commit after the prerequisite snapshot adds:

1. Authenticated GET/POST `/v1/assets/{asset_id}/cover`. Upload creates a new owned EPUB asset, preserving the original and chapter IDs. PNG/JPEG limits, bounded ZIP processing, safe paths and entity-safe XML parsing are included.
2. `covers` capability flags and size limit, so cover controls are conditional.
3. Optional job response fields: `sourceId`, `sourceCover`, `title`, `author`, `narratorVoiceId`, `castingMode`. The library can show meaningful books after a page reload or on another device.
4. Sanitized title-based download names instead of UUID-only names.
5. Real per-chapter speech-character counts in inspection responses.
6. `/v1/auth/session` identity lookup for bearer-authenticated servers, matching the existing browser-session endpoint. This scopes drafts by server and account.
7. Matching OpenAPI/types, explicit `defusedxml` dependency/lockfile entry, and regression tests.

There is no new database migration, TTS engine, character-attribution algorithm, pricing formula, Stripe implementation, deployment change, or retention policy in that implementation commit. Such changes visible between server `main` and the full worktree branch were already present in the original checkout and captured in prerequisite snapshot `2f5d572`.

Core conversion, casting and billing continue to use existing endpoints. New cover capabilities are optional. Hosted startup additionally requires the session identity endpoint; the companion server change supplies it for bearer mode. The complete new cover/library experience therefore requires the companion API additions.

## Verification boundaries

57 frontend tests and the web build pass after the audit. The browser suite covers real API upload/cover replacement, full-cast request creation in fixture mode, draft recovery, download, mobile themes and audio waveform activity. The server implementation previously passed 138 tests with six environment-dependent skips.

This is source, unit and fixture-browser verification. A packaged native build, live Stripe checkout, provisioned TTS and production PostgreSQL were not exercised. The local review server uses fixture audio.

## Fresh validation pass — September 16, 2026

Compared the current checkout at `05e0594` (including its uncommitted casting,
API and billing changes) with `feat/warm-studio` at `35461c1` (including its
existing uncommitted credit-pack/history and UI changes). Those changes were
preserved. This pass adds regression tests; it does not change application behavior.

- Current checkout: 53 frontend tests pass.
- Warm Studio: 62 frontend tests pass, including four new tests covering bounded
  polling after successful checkout, cancellation without polling, credit-history
  failure/recovery, and the full-cast draft → billing → draft → creation flow.
- The billing round-trip test verifies checkout through the Host, preserved
  narrator/model/fallback/method, no duplicate EPUB upload, and a fresh balance
  check before job creation. Payment confirmation is simulated in this test.
- Web production build passes. Generated API schema matches the companion
  `kenkui-server-warm-studio` worktree.

Reproduction from the Warm Studio worktree:

```sh
npm test
npm run build:web
KENKUI_SERVER_ROOT=/home/dizzler/Projects/Worktrees/kenkui-server-warm-studio npm run check:api
LD_LIBRARY_PATH=/home/dizzler/.cache/kenkui-browser-libs \
KENKUI_SERVER_ROOT=/home/dizzler/Projects/Worktrees/kenkui-server-warm-studio \
KENKUI_SERVER_PYTHON=/home/dizzler/Projects/Repos/kenkui-server/.venv/bin/python \
npm run test:e2e
```

The explicit server path is necessary in this worktree layout. Chromium initially
could not launch because the environment lacked `libasound.so.2`; an ARM64 ALSA
runtime was extracted into the local cache for browser validation without changing
system packages or repository dependencies.

Remaining operational checks before full parity sign-off:

1. Run against the intended hosted server with authenticated account/session
   discovery, sign-out/re-login, and account-isolated draft recovery.
2. Exercise Stripe test-mode checkout success/cancel and webhook-delayed balance
   updates, including purchased-pack history and conversion reservation/release.
   Frontend mocks do not prove payment settlement or ledger correctness.
3. Render actual multi-character text with a provisioned attribution model and TTS;
   listen for stable character voices, narrator and unknown-speaker fallback, and
   compare single/full-cast estimates. Browser fixture audio does not prove synthesis.
4. Verify the deployed API supplies the session endpoint required during startup;
   the new cover and library metadata features depend on the companion API additions.

No full operational parity claim is made by this test pass. The single-narrator
initial default remains an intentional difference from the current app's automatic
character-mode default when supported.

Browser result: both Playwright tests pass against the companion fixture server:
EPUB/cover upload, draft reload, full-cast creation and M4B download; mobile theme
switching, voice audition, audio waveform activity and overflow checks.
