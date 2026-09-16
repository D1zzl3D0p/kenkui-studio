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
