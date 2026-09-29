# Minor release review — 2026-09-28

## Scope and versions

Prepare **kenkui 10.2.0**, **kenkui-server 10.2.0**, and **kenkui-studio
10.1.0**. Versions advance independently; the server protocol stays `/v1`.
Publication authorized on 2026-09-29. Release branches will integrate the upstream
history and pass CI before tags are pushed.
The working trees already contained substantial work when this review began.
The version bumps include that work as a candidate, subject to the gates below.

Core/server branches have diverged from origin/main (fetched during review).
Do not publish a tag directly on either current HEAD. Integrate the upstream
history while retaining local features, then commit and validate the final tree.
The upstream TOC changes are already present as local edits, including an
untracked core chapter-assembly module; do not duplicate them by blindly
cherry-picking or discard them as unrelated dirt.

## Commit inclusion

Include all changes in the following ranges. Merge commits are omitted below;
retain normal merge ancestry when integrating. Documentation-only commits stay
in history but do not need separate user-facing release bullets.

### kenkui

Baseline: `v10.1.1`. Local committed candidates:

- `d71e48f` Add composable PDF preparation and isolated layout extraction
- `0e3ed51` Record safe diagnostics for failed model requests

Upstream-only commits to integrate:

- `97cba6b` Build audiobook chapters from EPUB table of contents

### kenkui-server

Baseline: `v10.1.0`. Local committed candidates:

- `74dcbc9` Email a reader when their book finishes
- `9fc72f7` Carry completion mail in its own worker secret
- `eb6b55a` Emit structured INFO diagnostics from hosted workers
- `50b98a0` Document missing-quote acceptance and cache reproduction
- `37a6a37` Record full coverage on identical Hyperion prompt retry

Upstream-only commits to integrate:

- `22c6ead` Reject stale chapter layouts with a re-upload instruction

### kenkui-studio

Baseline: `a81d65d`. Local committed candidates:

- `e441dbe` Use deterministic timers for bounded SSE recovery test
- `a7ff77c` Show sign-in action when hosted jobs require authentication
- `3cdb8e0` Explain flat book pricing and insufficient credit balances
- `05e0594` Ignore local agent caches and worktrees
- `c02279a` Finish hosted multi-voice casting UI
- `0a60be0` Snapshot existing billing and casting work for isolated studio implementation
- `26bbcd5` Implement warm Studio conversion and library experience
- `35461c1` Preserve job diagnostics and document Studio feature parity
- `de58d3e` Validate warm Studio parity and expose credit pack usage
- `a026143` Keep warm Studio model allowlist coverage after upstream merge
- `99bd6bb` Expose pause durations and speech preparation in Studio
- `35bca41` Simplify billing details and move account actions into the header
- `4bfc81c` Fix signed-out navigation and smooth book setup interactions
- `d6a13ec` Restore hosted voice samples and simplify the create review
- `3f63ae5` Add native desktop and mobile hosts with PKCE authentication
- `772ee60` Show each chapter's size while chapters are still being chosen
- `a4d23be` Regenerate the API contract types for the scene pause tier
- `4d41c3e` Offer a pause length for the break inside a chapter
- `6ac0c34` Open a new draft at a second of silence between scenes
- `097a77c` Stop a capability request outliving its test from failing the run
- `8a1d2d7` Tell a reader their book is ready
- `cf9b634` Add native CI builds and testing instructions

Studio has no release tags in the fetched repository. `a81d65d` is the explicit
10.0.0 source-release preparation commit, used as a documented baseline; it is
not proof of which build was deployed.

## Pending feature groups to include as separate commits

- Core: TOC chapter assembly (equivalent upstream history exists); chapter-title
  resolution and narration; strict quote-attribution coverage and cache repair;
  accompanying tests and documentation. Keep investigation notes as documentation.
- Server: stale-layout rejection (equivalent upstream history exists); chapter-title
  settings/preflight/capabilities/OpenAPI; PostgreSQL initial-connectivity handling
  and matching deployment configuration; accompanying tests and release notes.
- Studio: chapter-title controls, persisted draft compatibility, preflight display,
  generated API types, tests, and design notes.
- Then the review fixes and release metadata in each repository. Explicitly add
  new source/test files; a commit of tracked files alone would ship broken imports.

## Review fixes

1. **Dependency compatibility:** server called the new core `chapter_titles()`
   method unconditionally while allowing core 10.1.1. Raised the required core
   version to 10.2.0 so packaged installations cannot select an incompatible core.
2. **Cancellation:** the checkpoint cache returned validated responses without
   observing cancellation. Added checks before reading and after semantic
   validation, with regressions for already-cancelled and validation-time cancellation.
3. **Resource cleanup:** worker lease-release failures could skip database close.
   A nested `finally` now guarantees close even when lease release fails; regression
   coverage exercises the failure.
4. **Dependency update policy:** replaced Studio's eleven `latest` declarations
   with caret ranges anchored to the installed lockfile versions. No dependency
   upgrades were introduced. npm/Rust/Tauri version fields move together.
5. **Quality gate consistency:** fixed the seven existing whole-repository server
   Ruff findings and widened the workspace lint gate from `src` to the full repo.

## Follow-up maintainability work

These are scoped refactoring candidates, not claims that every large module is
incorrect. Keep them separate from release plumbing and preserve behavior with
existing tests.

- Core `src/kenkui/_domain/planning.py` (~1,936 lines) combines chapter-title
  insertion, grid planning, casting, and segment shaping. Extract chapter-title
  planning behind a typed boundary first; keep canonical offsets and synthesis
  cache identities covered during the move.
- Server `src/kenkui_server/worker.py` returns `Any` from database/repository/store
  factory hooks even though local and hosted workers rely on the same operations.
  Define structural protocols and type both implementations to make backend drift
  visible to mypy. Current strict mode still allows these explicit escape hatches.
- SQLite `storage/repositories.py` and PostgreSQL `storage/postgres.py` implement
  overlapping durable job behavior. Run a shared repository-contract suite against
  both before extracting common policy; avoid a generic SQL abstraction that hides
  lease and transaction semantics.
- Studio `studio/composer.tsx` (~752 lines) and `studio/studio.tsx` (~625 lines)
  combine network effects, draft transitions, and rendering. Extract draft/admission
  lifecycle hooks before splitting JSX. The older `pages/new-job.tsx` is another
  settings path: capability/default changes must remain consistent across both.
- Studio now has repository-local native CI (`cf9b634`). Server CI tests pinned Studio/core
  revisions, so it does not automatically validate a new Studio commit unless the
  configured sibling SHA is updated. Keep the coordinated-release gate pinned to the exact sibling revisions.

## Compatibility and release order

TOC regrouping changes chapter IDs. Core callers must re-inspect and refresh
selections. Server rejects stale stored inspections with HTTP 409 and a re-upload
instruction. Drain active jobs before deploying matching API/worker core revisions.
New synthesis pipelines announce authored chapter titles by default; core callers
can use `chapter_titles(enabled=False)`. Old persisted server jobs and Studio
drafts retain disabled announcements. These intentional behavioral changes must
remain prominent in release notes.

1. Integrate local and upstream commit histories, commit all candidate feature
   files, then commit the release metadata and review fixes.
2. Run checks on the resulting exact trees, including disposable PostgreSQL tests
   and native acceptance with provisioned assets.
3. Publish core 10.2.0. Its `v*` tag workflow publishes to PyPI and creates a GitHub
   release; pushing the tag is a publication action.
4. Update server CI's immutable core/Studio revision variables to the tested
   candidate commits. Build the verified server image and record its digest.
5. Deploy the compatible API and workers, check capabilities/preflight, then publish
   Studio 10.1.0. Studio's release includes web plus platform-specific artifacts;
   Linux unit tests alone do not establish macOS/Windows/mobile distribution readiness.

## Validation

- Core and server: whole-repository Ruff passes; strict mypy passes (225 and 57
  source files respectively). Both 10.2.0 wheels and source archives build.
  Core strict documentation build passes. Both uv lockfiles were regenerated
  offline and pass `uv lock --check --offline`; no third-party package versions changed.
- Core focused cancellation regressions: 23 tests passed in the character-model
  test module. The initial full-suite process started before edits completed:
  1,868 passed, 11 skipped, 10 deselected, and the two new cancellation cases
  failed against its loaded implementation; coverage was 92.34%. A clean full
  rerun stalled in filesystem I/O for over 19 minutes before producing output
  and was stopped. A later bounded retry passed the character-model module
  (including both new cancellation cases), then timed out after 120 seconds
  during EPUB tests. **The final full-suite gate remains incomplete.**
- Server: baseline 245 passed, 22 skipped; final worker lease regression module
  9 passed. Skips include disposable PostgreSQL and provisioned-voice acceptance.
  Checked OpenAPI export matches the generated contract.
- Studio: 145 unit tests pass; TypeScript/web production build passes; generated
  API contract check passes; npm offline dry-run install accepts manifest/lockfile.
- Browser tests: normal build-and-start acceptance exceeded the startup budget.
  Increased Playwright startup timeout to three minutes because it includes a
  production build. A diagnostic run using the existing production build started
  the server successfully, but all five tests were blocked before execution by
  missing Chromium system library `libasound.so.2`. Install the browser runtime
  dependencies and rerun the standard command.
- Core Twine metadata checks and wheel-layout checks passed after filesystem access
  recovered. Native Rust tests stalled in filesystem reads; a bounded offline retry
  reached compilation but did not finish within 60 seconds. Native validation remains
  incomplete.

Remaining publication gates: integrate history and commit pending files; rerun
full core tests, browser and native checks in a functioning
environment; run PostgreSQL and provisioned-asset acceptance; test the exact
committed cross-repository revisions. No release tags were created or pushed.
