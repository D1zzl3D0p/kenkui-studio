# Kenkui Studio — Design

Date: 2026-09-11
Status: Approved design. Amends `specs/03`, `02`, `04`, `05`, `00` (see §8).

## 1. Goal

Rename `kenkui-web` to `kenkui-studio` and ship the same React UI as both a
static web SPA and a Tauri 2 native application, without forking the UI.

The `/v1` HTTP/SSE contract remains the only boundary to `kenkui-server`.
No audiobook processing moves into client code.

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Native app is a **thin `/v1` client**; no bundled Python | `specs/03 §24`. A managed local server ("sidecar") comes later and must drop in without rearchitecture. |
| 2 | **Desktop released, mobile scaffolded** | macOS/Windows/Linux are the milestone. iOS/Android project files are committed and buildable but unreleased, so mobile assumptions are validated rather than assumed. |
| 3 | **Native HTTP/SSE goes through Rust**, plus CORS added to `kenkui-server` | A Tauri webview origin is `tauri://localhost`; every request and the SSE stream would otherwise be cross-origin. The Rust transport also defeats Android mixed-content blocking of plain-`http://` LAN servers. CORS is needed independently for the `app.*`/`api.*` split in `specs/04 §14`. |
| 4 | **Specs are amended as part of this work** | `specs/` is normative in this workspace; leaving it contradicting the tree misleads future contributors and agents. |
| 5 | **No CI, unsigned builds, no in-app updater** | Deferred by the user 2026-09-11. Distribution will go through external package managers. |

## 3. Architecture: the `Host` seam

The UI is 290 lines across 13 files. Its pages and components are untouched
except for the two additions named in §4 (a `host` prop on `App` and the
native-only `/servers` route). All platform divergence is confined behind one
interface.

```ts
// src/host/index.ts
export interface Host {
  readonly platform: "web" | "desktop" | "mobile";   // branding/diagnostics only
  readonly can: {
    chooseServer: boolean;       // web false: fixed serving origin
    reachLoopback: boolean;      // mobile false
    manageLocalServer: boolean;  // desktop only; flips true when the sidecar lands
    saveToPath: boolean;         // desktop true; web/mobile download or share
  };
  transport(baseUrl: string): ClientDependencies;
  servers: ServerRegistry;
  saveArtifact(blob: Blob, suggestedName: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  onResume(listener: () => void): () => void;   // see §3.2, backgrounding
}
```

Implementations: `src/host/web.ts` and `src/host/tauri.ts`. `vite.config.ts`
sets a `resolve.alias` entry mapping `@host` to one or the other per build mode
(a plain path alias, not a virtual-module plugin), so each bundle
tree-shakes the other away and the two type-check independently.

**Call sites branch on `host.can.*`, never on `host.platform`.** This is the
host-layer analogue of the `specs/03 §6` rule forbidding `if (isLocalServer)`
for feature semantics. A guard test enforces it mechanically (§7).

Consequences:

- Adding mobile means implementing methods, not editing call sites.
- When the sidecar lands, `manageLocalServer` flips `true` on desktop and the
  existing server picker gains a "managed local server" entry, with no
  call-site changes.

### 3.1 Why `src/api/` needs no changes

`ClientDependencies` (`src/api/client.ts:9-13`) already injects `fetch` and
`eventSource`. `EventSourceLike` (`src/api/events.ts:8-14`) is already a
structural interface rather than the DOM class.

The native SSE implementation, `ChannelEventSource`, satisfies `EventSourceLike`
and is backed by a Rust command that holds the `reqwest` stream, parses
`event:`/`data:` frames, and forwards them over a Tauri `Channel`.
`connectJobEvents` is therefore reused **verbatim** — its three-attempt
recovery, terminal-status detection, and refetch-on-disconnect logic
(`events.ts:38-88`) work unmodified on a transport they were not written for.

The only edit outside `src/host/`: the module-level
`const defaultClient = new KenkuiServerClient()` (`app.tsx:12`) moves into
`main.tsx`, constructed from the host and the selected server, then passed
through the `client` prop `App` already accepts (`app.tsx:13`).

### 3.2 Mobile divergence within "native"

| Concern | Desktop | Mobile |
|---|---|---|
| HTTP + SSE transport | identical Rust path | identical Rust path |
| Save an M4B | save dialog, any path | no user filesystem; share sheet / SAF |
| PKCE redirect | system browser to one-shot loopback listener | `ASWebAuthenticationSession` / Custom Tabs + `kenkui://` deep link |
| Reach a local server | yes | never (loopback rejected; LAN allowed) |
| Backgrounding | n/a | OS suspends the app and kills the SSE stream |

Desktop and mobile ship **the same JS bundle** through the same
`vite build --mode native`; `src/host/tauri.ts` composes the differing pieces at
startup from `@tauri-apps/plugin-os`'s `platform()`. Mobile adds no build mode,
only Rust targets.

**Backgrounding:** `MAX_RECOVERY_ATTEMPTS = 3` (`events.ts:20`) would be
exhausted by a suspended app. The fix belongs in the host, not the client — a
resume hook that triggers the existing `onDisconnect()` refetch path.
Scaffolded and tested on desktop this milestone; wired on mobile at mobile
release.

## 4. Server registry

```ts
export interface ServerEntry {
  id: string;
  label: string;
  baseUrl: string;                                  // "" on web = serving origin
  kind: "origin" | "cloud" | "custom" | "managed";  // "managed" reserved for the sidecar
}

export interface ServerRegistry {
  list(): Promise<ServerEntry[]>;
  selected(): Promise<ServerEntry>;
  select(id: string): Promise<void>;
  add(baseUrl: string, label?: string): Promise<ServerEntry>;
  remove(id: string): Promise<void>;
}
```

Web returns exactly one entry (`baseUrl: ""`) with `can.chooseServer === false`,
so the picker never renders — `specs/03 §5`: the hosted SPA "does not offer an
arbitrary `http://localhost` server chooser."

Native persists entries, seeded with Cloud, and validates `add()` by calling
`GET /v1/capabilities` — the same call boot already makes, so connection-testing
introduces no new surface. Mobile rejects **loopback** URLs only; a LAN address
is legitimate and reachable there via the Rust transport.

Boot: resolve the selected server, build the client, render. `App` takes a
`host` prop alongside `client`; its capabilities-failure branch (`app.tsx:23`)
gains a "choose another server" affordance when `can.chooseServer`. One new
native-only route, `/servers`, is added to the `Route` union (`router.tsx:1`).

## 5. Authentication

Capability-driven off `capabilities.auth.mode`; unchanged when `mode: "none"`.

Native PKCE: Rust generates the challenge, opens the system browser (desktop) or
`ASWebAuthenticationSession`/Custom Tabs (mobile), receives the redirect on a
one-shot loopback listener (desktop) or `kenkui://` deep link (mobile),
exchanges the code, and stores tokens **in the OS keychain**. The access token
is attached **by the Rust transport** and never enters the webview's JS heap — a
stronger position than the browser build can reach, obtained free from decision
3. This satisfies `specs/03 §9` ("do not put long-lived auth secrets in
localStorage").

**Scope limit.** No Cloud server is deployed (the workspace is at M3), and
`Capabilities.auth` carries only `{ mode: string }` — no issuer or
authorize/token endpoints a native client could discover. PKCE therefore lands
as **interface plus fake-server tests only**, exactly as `specs/05:316`
prescribes. Making it exercisable requires an additive `Capabilities.auth`
change in `kenkui-server`, listed as a dependency in §8 and out of scope here.

## 6. The Tauri shell

`src-tauri/src/`: `main.rs`, `http.rs` (a `reqwest` client and request command),
`sse.rs` (stream to `Channel`), `auth.rs` (PKCE and keychain).

**Custom Rust commands, not `tauri-plugin-http`.** SSE streaming requires a
custom command regardless; one transport code path beats two. Consequences:

- The Tauri ACL shrinks to the plugins actually used: `os`, `store`, `dialog`,
  `fs` (scoped to the chosen save directory), `opener`, `deep-link`.
- The webview issues **no network requests at all**, so CSP stays maximally
  strict (`default-src 'self'`, no `connect-src` allowances) — meaningful
  hardening for an app that opens user-supplied EPUBs.

`tauri.conf.json`: productName "Kenkui Studio", identifier `org.kenkui.studio`,
`frontendDist: "../dist"`, `beforeBuildCommand: "npm run build:native"`.

### 6.1 Targets and platform claims

Released: macOS (arm64, x86_64), Windows (NSIS), Linux (AppImage, deb).
Scaffolded: iOS and Android via `tauri ios/android init`, committed, unreleased.

With no CI, builds are local and the developer machine is macOS. **This
milestone may claim only macOS support**; Windows and Linux are configured but
unexercised until a machine or CI builds them, per the standard already set in
`docs/m1-rewrite-plan.md:186` ("do not claim support for a platform not actually
exercised").

### 6.2 Distribution and updates

No in-app updater. Distribution targets external package managers
(winget/Chocolatey, Homebrew Cask, apt, AUR), which need only **versioned
artifacts at stable URLs with published checksums** and nothing inside the app.
Packaging manifests live outside this repo and can be added per channel later.

Unsigned binaries draw friction from winget and Homebrew-cask upstream, so a
personal tap and AUR are the realistic first channels until signing lands. apt
repo signing is a free GPG key, unrelated to the deferred code-signing certs.

**Version skew**, the one thing an updater would have covered, is handled with
what already exists: `Capabilities.apiVersion`, with compatibility assigned to
the client boundary by `specs/03 §8`. On an unsupported `apiVersion` the app
reports that it is too old and must be updated through its package manager.

## 7. Testing

- **`ChannelEventSource` driving the real `connectJobEvents`** with a fake
  channel; assert existing semantics hold (three-attempt recovery,
  terminal-status stop, refetch-on-disconnect). Pure TypeScript — the riskiest
  new code needs neither a webview nor a Rust toolchain.
- **Host implementations** with per-method fakes; assert `can.*` flags and the
  single-entry web registry.
- **Rust `cargo test`**: SSE frame parsing (multi-line `data:`, comments,
  `\n\n` boundaries, mid-frame truncation) and PKCE challenge generation.
- **Guard test**: fail if `src/pages/` or `src/components/` mention
  `platform ===` or `__TAURI__`.
- **Native E2E: a manual smoke checklist**, not automated. `tauri-driver`
  without CI is not worth its weight this milestone. Recorded as a known gap.

TDD throughout.

### 7.1 E2E is currently broken in any worktree

Verified 2026-09-11: `playwright.config.ts:8` and `tests/e2e/local-server.py:14`
both locate `kenkui-server` as a filesystem sibling. That holds in the main
checkout; in a worktree it resolves to `.claude/worktrees/kenkui-server`, which
does not exist.

Fix: honor a `KENKUI_SERVER_ROOT` environment variable, defaulting to today's
sibling lookup. Roughly five lines; it unbreaks worktree development permanently
and decouples E2E from directory position, which the rename needs regardless.

## 8. Change sets

`kenkui-v2/` is **not a git repository**. `kenkui/`, `kenkui-server/`,
`kenkui-voices/`, and `kenkui-web/` are each separate repositories, so this work
cannot be one commit.

| Set | Contents | Home | VCS |
|---|---|---|---|
| 1 | `Host`, `ChannelEventSource`, `src-tauri/`, registry, tests, E2E path fix, `package.json` name | this repo | branch `worktree-kenkui-studio-refactor` |
| 2 | CORS middleware and config; fixture paths in `tests/test_beta_integration.py:16` and `tests/test_real_render.py:16` | `kenkui-server/` | its own branch |
| 3 | `specs/03` (retitle; §5 native connection model, §9 PKCE, §10 `/servers`, §24 normative, §25 host contract), `specs/02` (CORS), `specs/04` (rename, native artifacts outside Cloud infra), `specs/05` (resequence M8), `specs/00` (6 refs), specs README, workspace README layout constraints | `kenkui-v2/` | **none** |
| 4 | `kenkui-web/` → `kenkui-studio/` on disk; `.serena/project.yml` | filesystem | **not a git operation** |

Deferred dependency: an additive `Capabilities.auth` change in `kenkui-server`
exposing issuer and authorize/token endpoints, required before native PKCE can
be exercised. Not in this milestone.

## 9. Sequencing

Another agent is concurrently working in the main checkout and owns
`src/api/generated/` (migrating the hand-written `v1.ts` to an
`openapi-typescript`-generated `schema.ts` facade). This work does not touch
that directory.

1. **Now, in the worktree** — all of change set 1: everything depending on
   neither the rename nor another repository. Safe: no remote, nothing
   published.
2. **In parallel** — change set 2 on a `kenkui-server` branch. Purely additive.
3. **Wait** for the other agent's SDD work to land.
4. **Merge** this branch to `main`.
5. **Last, with both agents idle** — change sets 3 and 4: the directory rename,
   its four cross-references, and the spec amendments.

Step 5 is the only disruptive step: it renames a directory another session may
be working inside, and edits files with no version control to fall back on.
Everything before it is reversible.

**The implementation plan drawn from this design covers change sets 1 and 2
only.** Sets 3 and 4 are a coordinated follow-up requiring both agents idle, and
get their own short plan at that time.

## 10. Out of scope

Bundled Python sidecar; mobile release; CI; code signing and notarization;
in-app updater; package-manager manifests; exercisable PKCE; automated native
E2E; ESLint (a pre-existing gap — `specs/05:55` lists lint, but no config exists
in the repo).
