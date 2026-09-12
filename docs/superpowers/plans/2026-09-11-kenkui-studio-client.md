# Kenkui Studio Dual-Target Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the existing React UI as both a static web SPA and a Tauri 2 desktop app, with all platform divergence confined behind one `Host` interface.

**Architecture:** A `Host` interface supplies the transport, server registry, artifact saving, and external-link opening. `src/host/web.ts` and `src/host/tauri.ts` implement it; `vite.config.ts` aliases `@host` to one per build mode. Native HTTP and SSE run through custom Rust commands, so `src/api/` is reused unchanged — including `connectJobEvents`, which drives a `ChannelEventSource` that satisfies the existing `EventSourceLike` interface.

**Tech Stack:** TypeScript, React 19, Vite 8, Vitest, Playwright, Tauri 2, Rust (`reqwest`, `serde`, `tokio`).

**Spec:** `docs/superpowers/specs/2026-09-11-kenkui-studio-design.md`

## Global Constraints

- The `/v1` HTTP/SSE contract is the **only** boundary to `kenkui-server`. No audiobook processing in client code.
- **Do not modify `src/api/generated/`.** Another agent owns that directory (migrating `v1.ts` to an `openapi-typescript` facade). If a generated type is missing, import what exists and note it.
- Call sites in `src/pages/` and `src/components/` branch on `host.can.*`, **never** on `host.platform` and never on `window.__TAURI__`. Enforced by a guard test in Task 2.
- Existing UI behavior must not change. All 18 existing tests stay green after every task.
- This milestone claims **macOS only**. Do not assert Windows or Linux support; no machine builds them.
- No CI, no code signing, no in-app updater, no bundled Python sidecar. See spec §10.
- Native PKCE is **interface plus fake-server tests only**. It cannot be exercised — no Cloud server is deployed and `Capabilities.auth` carries only `{ mode: string }`.
- Work happens on branch `worktree-kenkui-studio-refactor` in the worktree at `.claude/worktrees/kenkui-studio-refactor`. Commit after every task.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/host/index.ts` | `Host`, `HostCapabilities`, `ServerEntry`, `ServerRegistry` types. Types only, no logic. |
| `src/host/web.ts` | Browser host: same-origin transport, single-entry registry, anchor download. Exports `createHost`. |
| `src/host/tauri.ts` | Native host: Rust transport, persisted registry, native save dialog. Exports `createHost`. |
| `src/host/channel-event-source.ts` | `EventSourceLike` implementation over a frame channel. Shared, platform-free. |
| `src/host/version.ts` | `apiVersion` compatibility check. Shared, platform-free. |
| `src/pages/servers.tsx` | Native-only server picker. |
| `src-tauri/src/http.rs` | `reqwest` client and the request command. |
| `src-tauri/src/sse.rs` | SSE frame parser and the streaming command. |
| `src-tauri/src/auth.rs` | PKCE challenge generation and keychain storage. |
| `tests/fakes/host.ts` | Shared fake `Host` for component tests. |

---

### Task 1: Make E2E locate `kenkui-server` independently of directory position

Playwright E2E cannot run in any worktree today: `playwright.config.ts:8` and `tests/e2e/local-server.py:14` both resolve `kenkui-server` as a filesystem sibling, which in this worktree points at `.claude/worktrees/kenkui-server` and does not exist. This blocks verification for every later task, so it goes first.

**Files:**
- Modify: `tests/e2e/local-server.py:12-15`
- Modify: `playwright.config.ts:6-10`

**Interfaces:**
- Consumes: nothing.
- Produces: environment variable `KENKUI_SERVER_ROOT` (absolute path to the `kenkui-server` checkout), honored by both files, defaulting to the existing sibling lookup.

- [ ] **Step 1: Write the failing test**

Create `tests/e2e/test_server_root.py`:

```python
"""The E2E harness must locate kenkui-server without assuming directory position."""

import os
import subprocess
import sys
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "local-server.py"


def test_honors_kenkui_server_root(tmp_path):
    """An explicit KENKUI_SERVER_ROOT overrides the sibling-directory default."""
    env = {**os.environ, "KENKUI_SERVER_ROOT": str(tmp_path), "KENKUI_PRINT_SERVER_ROOT": "1"}
    result = subprocess.run([sys.executable, str(HARNESS)], env=env, capture_output=True, text=True)
    assert result.stdout.strip() == str(tmp_path)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/e2e/test_server_root.py -v`
Expected: FAIL — the harness ignores both variables and tries to import `kenkui_server` from a path that does not exist.

- [ ] **Step 3: Write minimal implementation**

In `tests/e2e/local-server.py`, replace the `SERVER_ROOT` block (lines 12-15):

```python
WEB_ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ROOT = WEB_ROOT.parent
SERVER_ROOT = Path(os.environ.get("KENKUI_SERVER_ROOT") or REPOSITORY_ROOT / "kenkui-server").resolve()

if os.environ.get("KENKUI_PRINT_SERVER_ROOT"):
    print(SERVER_ROOT)
    raise SystemExit(0)

sys.path.insert(0, str(SERVER_ROOT / "src"))
```

`import os` is already present at the top of the file. The early exit must come **before** the `import kenkui as kk` line, so the probe does not require an installed server.

In `playwright.config.ts`, replace the `webServer.command` line:

```ts
import { defineConfig } from "@playwright/test";
import path from "node:path";

const serverRoot = process.env.KENKUI_SERVER_ROOT
  ?? path.resolve(__dirname, "..", "kenkui-server");

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: `npm run build && ${path.join(serverRoot, ".venv/bin/python")} tests/e2e/local-server.py`,
    url: "http://127.0.0.1:4173/v1/health",
    reuseExistingServer: false,
    env: { KENKUI_SERVER_ROOT: serverRoot },
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/e2e/test_server_root.py -v`
Expected: PASS

Then confirm E2E actually runs in the worktree:

Run: `KENKUI_SERVER_ROOT=/Users/dizzler/Projects/Repos/kenkui-v2/kenkui-server npx playwright test`
Expected: the existing `capability-shell.spec.ts` passes. If Playwright browsers are not installed, run `npx playwright install chromium` first.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/local-server.py tests/e2e/test_server_root.py playwright.config.ts
git commit -m "test: locate kenkui-server via KENKUI_SERVER_ROOT

Playwright E2E resolved kenkui-server as a filesystem sibling, which is
true only in the main checkout. In a worktree it resolved to a path that
does not exist, so E2E could not run at all."
```

---

### Task 2: Introduce the `Host` interface and the web host

**Files:**
- Create: `src/host/index.ts`, `src/host/web.ts`
- Create: `tests/fakes/host.ts`, `tests/host.test.ts`, `tests/guard.test.ts`
- Modify: `src/app.tsx:11-14`, `src/main.tsx`

**Interfaces:**
- Consumes: `ClientDependencies` from `src/api/client.ts`.
- Produces: `Host`, `HostCapabilities`, `ServerEntry`, `ServerRegistry` (types); `createHost(): Promise<Host>` from `src/host/web.ts`; `fakeHost(overrides?: Partial<Host>): Host` from `tests/fakes/host.ts`. `App` gains a **required** `host: Host` prop.

- [ ] **Step 1: Write the failing test**

Create `tests/host.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createHost } from "../src/host/web";

describe("web host", () => {
  it("reports browser capabilities", async () => {
    const host = await createHost();

    expect(host.platform).toBe("web");
    expect(host.can).toEqual({
      chooseServer: false,
      reachLoopback: true,
      manageLocalServer: false,
      saveToPath: false,
    });
  });

  it("uses the serving origin as its only server", async () => {
    const host = await createHost();

    await expect(host.servers.list()).resolves.toEqual([
      { id: "origin", label: "This server", baseUrl: "", kind: "origin" },
    ]);
    await expect(host.servers.selected()).resolves.toMatchObject({ baseUrl: "" });
  });

  it("refuses to add servers, because the hosted SPA offers no server chooser", async () => {
    const host = await createHost();

    await expect(host.servers.add("http://127.0.0.1:7850")).rejects.toThrow(/does not support/i);
  });

  it("returns the browser's own fetch and EventSource as its transport", async () => {
    const host = await createHost();

    expect(host.transport("")).toEqual({});
  });

  it("reports a resume when the document becomes visible again", async () => {
    const host = await createHost();
    const listener = vi.fn();
    const unsubscribe = host.onResume(listener);

    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
```

Add `vi` to the `vitest` import at the top of this file.

Create `tests/guard.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Pages and components branch on host.can.*, never on platform identity. */
const forbidden = [/platform\s*===/, /__TAURI__/, /isLocalServer/, /isKenkuiCloud/];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

describe("capability discipline", () => {
  it("keeps platform identity out of pages and components", () => {
    const offenders = [...sourceFiles("src/pages"), ...sourceFiles("src/components")]
      .filter((file) => forbidden.some((pattern) => pattern.test(readFileSync(file, "utf8"))));

    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/host.test.ts tests/guard.test.ts`
Expected: `host.test.ts` FAILS — cannot resolve `../src/host/web`. `guard.test.ts` PASSES (no offenders yet); it is a regression guard, so passing now is correct.

- [ ] **Step 3: Write minimal implementation**

Create `src/host/index.ts`:

```ts
import type { ClientDependencies } from "../api/client";

/** What the surrounding application can do, independent of which server it talks to. */
export interface HostCapabilities {
  /** The user may point the app at a different server. False for the hosted SPA. */
  chooseServer: boolean;
  /** 127.0.0.1 is reachable. False on mobile, where no local server exists. */
  reachLoopback: boolean;
  /** The host can start and supervise a local server. Reserved for the future sidecar. */
  manageLocalServer: boolean;
  /** Artifacts can be written to a user-chosen filesystem path. */
  saveToPath: boolean;
}

export interface ServerEntry {
  id: string;
  label: string;
  /** Empty string means "the origin this bundle was served from". */
  baseUrl: string;
  kind: "origin" | "cloud" | "custom" | "managed";
}

export interface ServerRegistry {
  list(): Promise<ServerEntry[]>;
  selected(): Promise<ServerEntry>;
  select(id: string): Promise<void>;
  add(baseUrl: string, label?: string): Promise<ServerEntry>;
  remove(id: string): Promise<void>;
}

/** The application's only boundary to the platform it runs on. */
export interface Host {
  /** Branding and diagnostics only. Never branch feature behavior on this. */
  readonly platform: "web" | "desktop" | "mobile";
  readonly can: HostCapabilities;
  /** baseUrl scopes credential attachment, so a Cloud token never reaches a LAN server. */
  transport(baseUrl: string): ClientDependencies;
  readonly servers: ServerRegistry;
  saveArtifact(blob: Blob, suggestedName: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  /**
   * Fires when the app returns to the foreground. Mobile suspends the process
   * and kills the SSE stream, which would otherwise exhaust the three recovery
   * attempts in events.ts while asleep. Returns an unsubscribe function.
   */
  onResume(listener: () => void): () => void;
}
```

Create `src/host/web.ts`:

```ts
import type { Host, ServerEntry } from "./index";

const origin: ServerEntry = { id: "origin", label: "This server", baseUrl: "", kind: "origin" };

/** The browser host. The SPA talks to the origin it was served from and nothing else. */
export async function createHost(): Promise<Host> {
  return {
    platform: "web",
    can: { chooseServer: false, reachLoopback: true, manageLocalServer: false, saveToPath: false },
    transport: () => ({}),
    servers: {
      list: async () => [origin],
      selected: async () => origin,
      select: async () => undefined,
      add: async () => { throw new Error("The web app does not support choosing a server."); },
      remove: async () => { throw new Error("The web app does not support choosing a server."); },
    },
    saveArtifact: async (blob, suggestedName) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = suggestedName;
      link.click();
      URL.revokeObjectURL(url);
    },
    openExternal: async (url) => { window.location.assign(url); },
    onResume: (listener) => {
      const wake = () => { if (document.visibilityState === "visible") listener(); };
      document.addEventListener("visibilitychange", wake);
      return () => document.removeEventListener("visibilitychange", wake);
    },
  };
}
```

Create `tests/fakes/host.ts`:

```ts
import { vi } from "vitest";
import type { Host, ServerEntry } from "../../src/host/index";

const origin: ServerEntry = { id: "origin", label: "This server", baseUrl: "", kind: "origin" };

/** A Host for component tests. Override only what the test is about. */
export function fakeHost(overrides: Partial<Host> = {}): Host {
  return {
    platform: "web",
    can: { chooseServer: false, reachLoopback: true, manageLocalServer: false, saveToPath: false },
    transport: () => ({}),
    servers: {
      list: vi.fn().mockResolvedValue([origin]),
      selected: vi.fn().mockResolvedValue(origin),
      select: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue(origin),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    saveArtifact: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    onResume: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}
```

In `src/app.tsx`, delete the `defaultClient` line and make both props required:

```tsx
import type { Host } from "./host/index";

interface AppProps { client: KenkuiServerClient; host: Host; initialPath?: string }

export function App({ client, host, initialPath }: AppProps) {
```

`host` is unused in `App` until Task 3. Add `void host;` immediately inside the function body to satisfy `noUnusedParameters`, and delete that line in Task 3.

Replace `src/main.tsx` in full:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { KenkuiServerClient } from "./api/client";
import { createHost } from "./host/web";

const host = await createHost();
const server = await host.servers.selected();
const client = new KenkuiServerClient(server.baseUrl, host.transport(server.baseUrl));

createRoot(document.getElementById("root")!).render(
  <StrictMode><App client={client} host={host} /></StrictMode>,
);
```

Update every `render(<App ... />)` call site in `tests/app.test.tsx` and `tests/casting.test.tsx` to pass the fake:

```tsx
import { fakeHost } from "./fakes/host";

render(<App client={client as never} host={fakeHost()} initialPath="/jobs/new" />);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 18 existing tests plus 5 new ones.

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/host tests/fakes tests/host.test.ts tests/guard.test.ts src/app.tsx src/main.tsx tests/app.test.tsx tests/casting.test.tsx
git commit -m "feat: introduce the Host seam and web host

Confines platform divergence behind one interface whose call sites branch
on capability flags rather than platform identity, mirroring the
capability-first rule in specs/03 section 6. A guard test enforces it."
```

---

### Task 3: Server registry drives application boot

**Files:**
- Modify: `src/app.tsx` (capabilities-failure branch)
- Modify: `tests/app.test.tsx`

**Interfaces:**
- Consumes: `Host`, `fakeHost` from Task 2.
- Produces: `App` renders a "Choose another server" affordance when `host.can.chooseServer` and capabilities fail to load.

- [ ] **Step 1: Write the failing test**

Append to `tests/app.test.tsx`:

```tsx
describe("connection failure", () => {
  it("offers a server change when the host can choose servers", async () => {
    const offline = { ...client, capabilities: vi.fn().mockRejectedValue(new Error("offline")) };
    const host = fakeHost({
      can: { chooseServer: true, reachLoopback: true, manageLocalServer: false, saveToPath: true },
    });

    render(<App client={offline as never} host={host} initialPath="/jobs" />);

    await screen.findByText(/offline/);
    expect(screen.getByRole("button", { name: "Choose another server" })).toBeVisible();
  });

  it("offers no server change in the browser, which has a fixed origin", async () => {
    const offline = { ...client, capabilities: vi.fn().mockRejectedValue(new Error("offline")) };

    render(<App client={offline as never} host={fakeHost()} initialPath="/jobs" />);

    await screen.findByText(/offline/);
    expect(screen.queryByRole("button", { name: "Choose another server" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app.test.tsx -t "offers a server change"`
Expected: FAIL — no such button.

- [ ] **Step 3: Write minimal implementation**

In `src/app.tsx`, remove the `void host;` line added in Task 2 and replace the error branch:

```tsx
if (error) return <main><h1>Kenkui Studio</h1><ErrorMessage error={error} />
  {host.can.chooseServer && <button type="button" onClick={() => navigate("/servers")}>Choose another server</button>}
</main>;
```

`navigate` is declared above the error branch already, so no reordering is needed. The `/servers` route itself arrives in Task 11; until then the button navigates to a path that falls through to the jobs list, which is acceptable intermediate state.

Also update the loading branch heading to `Kenkui Studio` for consistency.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app.tsx tests/app.test.tsx
git commit -m "feat: offer a server change when the host can choose one"
```

---

### Task 4: Route artifact download through the host

**Files:**
- Modify: `src/pages/job.tsx:33-40`
- Modify: `tests/app.test.tsx`

**Interfaces:**
- Consumes: `Host.saveArtifact` from Task 2.
- Produces: `JobPage` accepts a `host: Host` prop and delegates saving to it. The anchor-click logic now lives only in `src/host/web.ts`.

- [ ] **Step 1: Write the failing test**

Append to `tests/app.test.tsx`:

```tsx
describe("artifact download", () => {
  it("delegates saving to the host", async () => {
    const blob = new Blob(["audio"], { type: "audio/mp4" });
    const succeeded = {
      ...client,
      getJob: vi.fn().mockResolvedValue({ id: "job-1", status: "succeeded", progress: { stage: "complete", completed: 2, total: 2 } }),
      artifact: vi.fn().mockResolvedValue(blob),
    };
    const host = fakeHost();

    render(<App client={succeeded as never} host={host} initialPath="/jobs/job-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Download M4B" }));

    await waitFor(() => expect(host.saveArtifact).toHaveBeenCalledWith(blob, "job-1.m4b"));
  });

  it("refetches the job snapshot when the app returns to the foreground", async () => {
    let resume: () => void = () => undefined;
    const onDisconnect = vi.fn().mockResolvedValue(undefined);
    const running = {
      ...client,
      getJob: vi.fn().mockResolvedValue({ id: "job-1", status: "running", progress: { stage: "synthesis", completed: 1, total: 2 } }),
      events: vi.fn().mockReturnValue({ close: vi.fn(), onDisconnect }),
    };
    const host = fakeHost({ onResume: (listener) => { resume = listener; return () => undefined; } });

    render(<App client={running as never} host={host} initialPath="/jobs/job-1" />);
    await screen.findByText("Status: running");
    act(() => resume());

    await waitFor(() => expect(onDisconnect).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app.test.tsx -t "delegates saving"`
Expected: FAIL — `host.saveArtifact` never called; the page builds its own anchor.

- [ ] **Step 3: Write minimal implementation**

In `src/pages/job.tsx`, extend the props and replace the body of `download`:

```tsx
import type { Host } from "../host/index";

interface JobPageProps { client: KenkuiServerClient; host: Host; jobId: string }
```

```tsx
  const download = async () => {
    try {
      setDownloading(true);
      await host.saveArtifact(await client.artifact(jobId), `${jobId}.m4b`);
    } catch (cause) { setError(cause); } finally { setDownloading(false); }
  };
```

In the same file, subscribe to resume inside the existing effect. Replace its
closing lines:

```tsx
    void client.getJob(jobId).then(update).catch(setError);
    const stream = client.events(jobId, updateFromEvent, update);
    const unsubscribe = host.onResume(() => { void stream.onDisconnect().catch(setError); });
    return () => { active = false; unsubscribe(); stream.close(); };
  }, [client, host, jobId]);
```

A suspended app would otherwise burn all three recovery attempts in
`events.ts:20` while asleep. Reusing `onDisconnect()` makes resume the same
refetch the stream already performs, rather than a second recovery mechanism.

Add `host` to the destructured parameters, and pass it from `src/app.tsx`:

```tsx
{route.page === "job" && route.jobId && <JobPage client={client} host={host} jobId={route.jobId} />}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

Run: `KENKUI_SERVER_ROOT=/Users/dizzler/Projects/Repos/kenkui-v2/kenkui-server npx playwright test`
Expected: PASS — the E2E download assertion still holds, because the web host reproduces the original anchor behavior exactly.

- [ ] **Step 5: Commit**

```bash
git add src/pages/job.tsx src/app.tsx tests/app.test.tsx
git commit -m "refactor: save artifacts through the host"
```

---

### Task 5: Reject servers the app is too old to speak to

**Files:**
- Create: `src/host/version.ts`, `tests/version.test.ts`
- Modify: `src/app.tsx`

**Interfaces:**
- Consumes: `Capabilities` from `src/api/generated/v1`.
- Produces: `supportedApiVersions: readonly string[]` and `isSupportedApiVersion(capabilities: { apiVersion: string }): boolean` from `src/host/version.ts`.

This replaces what an in-app updater would have covered. `specs/03 §8` assigns API version compatibility to the client boundary.

- [ ] **Step 1: Write the failing test**

Create `tests/version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isSupportedApiVersion, supportedApiVersions } from "../src/host/version";

describe("api version compatibility", () => {
  it("accepts the version this build speaks", () => {
    expect(supportedApiVersions).toContain("1");
    expect(isSupportedApiVersion({ apiVersion: "1" })).toBe(true);
  });

  it("rejects a newer server this build predates", () => {
    expect(isSupportedApiVersion({ apiVersion: "2" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/version.test.ts`
Expected: FAIL — cannot resolve `../src/host/version`.

- [ ] **Step 3: Write minimal implementation**

Create `src/host/version.ts`:

```ts
/** The /v1 API versions this build understands. */
export const supportedApiVersions = ["1"] as const;

export function isSupportedApiVersion(capabilities: { apiVersion: string }): boolean {
  return (supportedApiVersions as readonly string[]).includes(capabilities.apiVersion);
}
```

In `src/app.tsx`, after capabilities load and before rendering routes:

```tsx
if (!isSupportedApiVersion(capabilities)) return <main><h1>Kenkui Studio</h1>
  <p>This version of Kenkui Studio is too old to talk to this server. Update it through your package manager.</p>
</main>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/host/version.ts tests/version.test.ts src/app.tsx
git commit -m "feat: refuse servers speaking an unsupported api version

Covers the version-skew case an in-app updater would otherwise handle."
```

---

### Task 6: `ChannelEventSource`

The riskiest new code, and deliberately testable without Rust or a webview.

**Files:**
- Create: `src/host/channel-event-source.ts`, `tests/channel-event-source.test.ts`

**Interfaces:**
- Consumes: `EventSourceLike`, `EventSourceFactory` from `src/api/events.ts`; `connectJobEvents` from the same module.
- Produces: `EventFrame { type: string; data: string }`, `EventChannel { onFrame, onError, close }`, `EventChannelFactory = (url: string) => EventChannel`, and `channelEventSourceFactory(open: EventChannelFactory): EventSourceFactory`.

- [ ] **Step 1: Write the failing test**

Create `tests/channel-event-source.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { channelEventSourceFactory, type EventChannel, type EventFrame } from "../src/host/channel-event-source";
import { connectJobEvents } from "../src/api/events";

function fakeChannel() {
  let frame: (value: EventFrame) => void = () => undefined;
  let fail: () => void = () => undefined;
  const close = vi.fn();
  const channel: EventChannel = {
    onFrame: (listener) => { frame = listener; },
    onError: (listener) => { fail = listener; },
    close,
  };
  return { channel, close, emit: (value: EventFrame) => frame(value), fail: () => fail() };
}

describe("ChannelEventSource", () => {
  it("delivers named events to addEventListener subscribers", () => {
    const harness = fakeChannel();
    const Source = channelEventSourceFactory(() => harness.channel);
    const source = new Source("http://server.test/v1/jobs/job-1/events");
    const received: string[] = [];
    source.addEventListener("progress", (event) => received.push(event.data));

    harness.emit({ type: "progress", data: '{"sequence":1}' });

    expect(received).toEqual(['{"sequence":1}']);
  });

  it("delivers unnamed events to onmessage", () => {
    const harness = fakeChannel();
    const Source = channelEventSourceFactory(() => harness.channel);
    const source = new Source("http://server.test/v1/jobs/job-1/events");
    const received: string[] = [];
    source.onmessage = (event) => received.push(event.data);

    harness.emit({ type: "message", data: "plain" });

    expect(received).toEqual(["plain"]);
  });

  it("closes the underlying channel", () => {
    const harness = fakeChannel();
    const Source = channelEventSourceFactory(() => harness.channel);

    new Source("http://server.test/v1/jobs/job-1/events").close();

    expect(harness.close).toHaveBeenCalled();
  });

  it("preserves connectJobEvents recovery semantics on a channel transport", async () => {
    const harness = fakeChannel();
    const Source = channelEventSourceFactory(() => harness.channel);
    const refetch = vi.fn().mockResolvedValue({
      id: "job-1", status: "succeeded", progress: { stage: "complete", completed: 1, total: 1 },
    });
    const snapshots: string[] = [];

    const stream = connectJobEvents(
      "http://server.test/v1/jobs/job-1/events",
      Source,
      refetch,
      undefined,
      (job) => snapshots.push(job.status),
    );
    harness.fail();
    await stream.onDisconnect();

    expect(refetch).toHaveBeenCalled();
    expect(snapshots).toContain("succeeded");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/channel-event-source.test.ts`
Expected: FAIL — cannot resolve `../src/host/channel-event-source`.

- [ ] **Step 3: Write minimal implementation**

Create `src/host/channel-event-source.ts`:

```ts
import type { EventSourceFactory, EventSourceLike } from "../api/events";

/** One parsed server-sent event. `type` is "message" when the frame names no event. */
export interface EventFrame { type: string; data: string }

/** A transport-agnostic stream of frames, satisfied natively by a Tauri Channel. */
export interface EventChannel {
  onFrame(listener: (frame: EventFrame) => void): void;
  onError(listener: () => void): void;
  close(): void;
}

export type EventChannelFactory = (url: string) => EventChannel;

/**
 * Adapts a frame channel to the EventSource shape `connectJobEvents` expects,
 * so its reconnect and recovery logic is reused unchanged off the browser.
 */
export function channelEventSourceFactory(open: EventChannelFactory): EventSourceFactory {
  return class ChannelEventSource implements EventSourceLike {
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
    private readonly channel: EventChannel;

    constructor(url: string) {
      this.channel = open(url);
      this.channel.onFrame((frame) => {
        const message = new MessageEvent(frame.type, { data: frame.data }) as MessageEvent<string>;
        if (frame.type === "message") this.onmessage?.(message);
        for (const listener of this.listeners.get(frame.type) ?? []) listener(message);
      });
      this.channel.onError(() => this.onerror?.(new Event("error")));
    }

    addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    close(): void { this.channel.close(); }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/host/channel-event-source.ts tests/channel-event-source.test.ts
git commit -m "feat: adapt a frame channel to the EventSource contract

connectJobEvents keeps its three-attempt recovery and refetch-on-disconnect
behavior on a transport it was not written for."
```

---

### Task 7: Tauri scaffold and dual build modes

**Files:**
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/capabilities/default.json`
- Create: `src/host/tauri.ts` (stub)
- Modify: `vite.config.ts`, `tsconfig.json`, `package.json`, `.gitignore`, `src/main.tsx`

**Interfaces:**
- Consumes: `createHost` from Task 2.
- Produces: the `@host` alias resolving to `src/host/web.ts` by default and `src/host/tauri.ts` under `--mode native`; npm scripts `build:web`, `build:native`, `dev:native`, `tauri`.

- [ ] **Step 1: Write the failing test**

Create `tests/build-modes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import config from "../vite.config";

function aliasFor(mode: string): string {
  const factory = config as unknown as (env: { command: string; mode: string }) => unknown;
  const resolved = factory({ command: "build", mode });
  return (resolved as { resolve: { alias: Record<string, string> } }).resolve.alias["@host"];
}

describe("build modes", () => {
  it("resolves @host to the web host by default", () => {
    expect(aliasFor("production")).toBe(resolve(process.cwd(), "src/host/web.ts"));
  });

  it("resolves @host to the native host under the native mode", () => {
    expect(aliasFor("native")).toBe(resolve(process.cwd(), "src/host/tauri.ts"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build-modes.test.ts`
Expected: FAIL — `config` is an object with no `resolve.alias`.

- [ ] **Step 3: Write minimal implementation**

Replace `vite.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@host": resolve(process.cwd(), mode === "native" ? "src/host/tauri.ts" : "src/host/web.ts"),
    },
  },
  server: {
    proxy: {
      "/v1": "http://127.0.0.1:8000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["**/node_modules/**", "tests/e2e/**"],
    clearMocks: true,
  },
}));
```

In `tsconfig.json`, add inside `compilerOptions` so `tsc` can resolve the alias:

```json
    "baseUrl": ".",
    "paths": { "@host": ["src/host/web.ts"] },
```

`src/host/tauri.ts` is still type-checked, because `include` already covers `src`.

In `src/main.tsx`, change the host import to the alias:

```tsx
import { createHost } from "@host";
```

Create `src/host/tauri.ts` as a stub that Task 10 fills in:

```ts
import type { Host } from "./index";

/** The native host. Filled in by later tasks; shape fixed now so builds resolve. */
export async function createHost(): Promise<Host> {
  throw new Error("The native host is not implemented yet.");
}
```

In `package.json`, rename the package. This is safe and self-contained: the repo
has no git remote and nothing is published, so the name is local metadata only.
The **directory** rename is deliberately not part of this plan (spec §9, step 5).

```json
  "name": "kenkui-studio",
```

Then replace the `build` script and add the rest:

```json
    "dev": "vite",
    "dev:native": "vite --mode native",
    "build": "npm run build:web",
    "build:web": "tsc -b && vite build",
    "build:native": "tsc -b && vite build --mode native",
    "tauri": "tauri",
```

Keeping `build` as an alias for `build:web` preserves `playwright.config.ts`, which runs `npm run build`.

Add `@tauri-apps/cli` and `@tauri-apps/api`:

```bash
npm install --save-dev @tauri-apps/cli
npm install @tauri-apps/api
```

Append to `.gitignore`:

```
src-tauri/target/
src-tauri/gen/
```

Create `src-tauri/Cargo.toml`:

```toml
[package]
name = "kenkui-studio"
version = "0.1.0"
edition = "2021"
rust-version = "1.77"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["stream"] }
tokio = { version = "1", features = ["macros"] }
futures-util = "0.3"

[lib]
name = "kenkui_studio_lib"
crate-type = ["lib", "cdylib", "staticlib"]
```

Create `src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

Create `src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Kenkui Studio",
  "version": "0.1.0",
  "identifier": "org.kenkui.studio",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev:native",
    "beforeBuildCommand": "npm run build:native"
  },
  "app": {
    "windows": [{ "title": "Kenkui Studio", "width": 1100, "height": 800 }],
    "security": { "csp": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'" }
  },
  "bundle": { "active": true, "targets": ["app", "dmg"], "icon": ["icons/icon.png"] }
}
```

The CSP grants no `connect-src`, because the webview makes no network requests — all HTTP and SSE run in Rust.

Create `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capabilities for the Kenkui Studio window.",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

Create `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Kenkui Studio");
}
```

The bundler requires an icon. Generate the full icon set from a single 512×512
source PNG:

```bash
mkdir -p src-tauri/icons
# Any 512x512 PNG works as the placeholder source.
npx tauri icon path/to/source.png
```

If no artwork exists yet, generate a solid placeholder first:

```bash
npx --yes sharp-cli@5 -i /dev/null -o src-tauri/icons/icon.png 2>/dev/null \
  || python3 -c "from PIL import Image; Image.new('RGB', (512, 512), '#222').save('src-tauri/icons/icon.png')"
```

Record in the commit message that the icon is a placeholder pending real artwork.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — the two new build-mode tests plus all prior tests.

Run: `npm run build:web && npm run build:native`
Expected: both succeed.

Run: `cd src-tauri && cargo check`
Expected: compiles.

- [ ] **Step 5: Commit**

```bash
git add src-tauri src/host/tauri.ts vite.config.ts tsconfig.json package.json package-lock.json .gitignore src/main.tsx tests/build-modes.test.ts
git commit -m "build: add the Tauri shell and dual build modes

The webview gets no connect-src: all HTTP and SSE run in Rust."
```

---

### Task 8: Rust HTTP request command

**Files:**
- Create: `src-tauri/src/http.rs`, `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: Tauri command `kenkui_request(spec: RequestSpec) -> Result<ResponseSpec, String>`, where `RequestSpec { url: String, method: String, headers: Vec<(String, String)>, body: Option<Vec<u8>> }` and `ResponseSpec { status: u16, headers: Vec<(String, String)>, body: Vec<u8> }`. Task 10 consumes these from TypeScript.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/http.rs` containing only its tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_method_it_supports() {
        assert_eq!(method_from("POST").unwrap(), reqwest::Method::POST);
    }

    #[test]
    fn rejects_a_method_it_does_not_support() {
        assert!(method_from("TRACE").is_err());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test`
Expected: FAIL — `method_from` is not defined.

- [ ] **Step 3: Write minimal implementation**

Prepend to `src-tauri/src/http.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct RequestSpec {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
}

#[derive(Serialize)]
pub struct ResponseSpec {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// Only the verbs the /v1 client actually issues.
pub fn method_from(name: &str) -> Result<reqwest::Method, String> {
    match name.to_ascii_uppercase().as_str() {
        "GET" => Ok(reqwest::Method::GET),
        "POST" => Ok(reqwest::Method::POST),
        "DELETE" => Ok(reqwest::Method::DELETE),
        other => Err(format!("unsupported method: {other}")),
    }
}

#[tauri::command]
pub async fn kenkui_request(spec: RequestSpec) -> Result<ResponseSpec, String> {
    let client = reqwest::Client::new();
    let mut request = client.request(method_from(&spec.method)?, &spec.url);
    for (name, value) in &spec.headers {
        request = request.header(name, value);
    }
    if let Some(body) = spec.body {
        request = request.body(body);
    }

    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_str().unwrap_or_default().to_string()))
        .collect();
    let body = response.bytes().await.map_err(|error| error.to_string())?.to_vec();

    Ok(ResponseSpec { status, headers, body })
}
```

Create `src-tauri/src/lib.rs`:

```rust
pub mod http;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![http::kenkui_request])
        .run(tauri::generate_context!())
        .expect("error while running Kenkui Studio");
}
```

Replace the body of `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kenkui_studio_lib::run()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat: add the native HTTP request command

Routing requests through Rust sidesteps the tauri:// origin entirely and
lets a plain-http LAN server work where a webview would block it."
```

---

### Task 9: Rust SSE parser and streaming command

**Files:**
- Create: `src-tauri/src/sse.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Frame { event: String, data: String }`, `parse_frames(buffer: &mut String) -> Vec<Frame>`, and Tauri command `kenkui_events_open(url: String, channel: tauri::ipc::Channel<Frame>) -> Result<(), String>`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/sse.rs` containing only its tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_event_and_keeps_the_data() {
        let mut buffer = String::from("event: progress\ndata: {\"sequence\":1}\n\n");
        let frames = parse_frames(&mut buffer);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].event, "progress");
        assert_eq!(frames[0].data, "{\"sequence\":1}");
        assert!(buffer.is_empty());
    }

    #[test]
    fn defaults_the_event_name_to_message() {
        let mut buffer = String::from("data: plain\n\n");
        assert_eq!(parse_frames(&mut buffer)[0].event, "message");
    }

    #[test]
    fn joins_multi_line_data_with_newlines() {
        let mut buffer = String::from("data: one\ndata: two\n\n");
        assert_eq!(parse_frames(&mut buffer)[0].data, "one\ntwo");
    }

    #[test]
    fn ignores_comments_and_unknown_fields() {
        let mut buffer = String::from(": keep-alive\nid: 7\nretry: 500\ndata: kept\n\n");
        let frames = parse_frames(&mut buffer);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data, "kept");
    }

    #[test]
    fn retains_a_partial_frame_for_the_next_chunk() {
        let mut buffer = String::from("data: complete\n\ndata: partial");
        let frames = parse_frames(&mut buffer);
        assert_eq!(frames.len(), 1);
        assert_eq!(buffer, "data: partial");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test`
Expected: FAIL — `parse_frames` and `Frame` are not defined.

- [ ] **Step 3: Write minimal implementation**

Prepend to `src-tauri/src/sse.rs`:

```rust
use futures_util::StreamExt;
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct Frame {
    pub event: String,
    pub data: String,
}

/// Drains every complete server-sent event from `buffer`, leaving any partial frame behind.
pub fn parse_frames(buffer: &mut String) -> Vec<Frame> {
    let mut frames = Vec::new();

    while let Some(index) = buffer.find("\n\n") {
        let block: String = buffer.drain(..index + 2).collect();
        let mut event = String::from("message");
        let mut data: Vec<String> = Vec::new();

        for line in block.lines() {
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            let (field, value) = match line.split_once(':') {
                Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
                None => (line, ""),
            };
            match field {
                "event" => event = value.to_string(),
                "data" => data.push(value.to_string()),
                _ => {}
            }
        }

        if !data.is_empty() {
            frames.push(Frame { event, data: data.join("\n") });
        }
    }

    frames
}

#[tauri::command]
pub async fn kenkui_events_open(
    url: String,
    channel: tauri::ipc::Channel<Frame>,
) -> Result<(), String> {
    let response = reqwest::Client::new()
        .get(&url)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        for frame in parse_frames(&mut buffer) {
            channel.send(frame).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}
```

In `src-tauri/src/lib.rs`, register the module and command:

```rust
pub mod http;
pub mod sse;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![http::kenkui_request, sse::kenkui_events_open])
        .run(tauri::generate_context!())
        .expect("error while running Kenkui Studio");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat: stream server-sent events from Rust over a channel"
```

---

### Task 10: The native host

**Files:**
- Modify: `src/host/tauri.ts`
- Create: `tests/tauri-host.test.ts`

**Interfaces:**
- Consumes: `Host` (Task 2), `channelEventSourceFactory` (Task 6), `kenkui_request` (Task 8), `kenkui_events_open` (Task 9).
- Produces: `createHost(): Promise<Host>` from `src/host/tauri.ts`; `nativeFetch(invoke, baseUrl, token?): typeof globalThis.fetch` and `hostCapabilitiesFor(platform: string): HostCapabilities`, both exported for testing.

- [ ] **Step 1: Write the failing test**

Create `tests/tauri-host.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { hostCapabilitiesFor, nativeFetch } from "../src/host/tauri";

describe("native host capabilities", () => {
  it("lets a desktop reach a local server and write files", () => {
    expect(hostCapabilitiesFor("macos")).toEqual({
      chooseServer: true, reachLoopback: true, manageLocalServer: false, saveToPath: true,
    });
  });

  it("denies loopback and path saving on mobile", () => {
    expect(hostCapabilitiesFor("ios")).toEqual({
      chooseServer: true, reachLoopback: false, manageLocalServer: false, saveToPath: false,
    });
  });
});

describe("native fetch", () => {
  it("sends the request through Rust and rebuilds a Response", async () => {
    const invoke = vi.fn().mockResolvedValue({
      status: 200,
      headers: [["content-type", "application/json"]],
      body: Array.from(new TextEncoder().encode('{"apiVersion":"1"}')),
    });

    const response = await nativeFetch(invoke, "https://api.test")("https://api.test/v1/capabilities");

    expect(await response.json()).toEqual({ apiVersion: "1" });
    expect(invoke).toHaveBeenCalledWith("kenkui_request", expect.objectContaining({
      spec: expect.objectContaining({ url: "https://api.test/v1/capabilities", method: "GET" }),
    }));
  });

  it("attaches the token only to the selected server's origin", async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 200, headers: [], body: [] });
    const fetcher = nativeFetch(invoke, "https://api.test", "secret-token");

    await fetcher("https://api.test/v1/jobs");
    await fetcher("http://192.168.1.20:7850/v1/jobs");

    const headersFor = (call: number) =>
      Object.fromEntries(invoke.mock.calls[call][1].spec.headers as [string, string][]);
    expect(headersFor(0).Authorization).toBe("Bearer secret-token");
    expect(headersFor(1).Authorization).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tauri-host.test.ts`
Expected: FAIL — `hostCapabilitiesFor` and `nativeFetch` are not exported.

- [ ] **Step 3: Write minimal implementation**

Replace `src/host/tauri.ts`:

```ts
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import type { Host, HostCapabilities } from "./index";
import { channelEventSourceFactory, type EventChannel, type EventFrame } from "./channel-event-source";

type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;
const mobilePlatforms: Record<string, true> = { ios: true, android: true };

export function hostCapabilitiesFor(platform: string): HostCapabilities {
  const mobile = Boolean(mobilePlatforms[platform]);
  return {
    chooseServer: true,
    reachLoopback: !mobile,
    manageLocalServer: false,
    saveToPath: !mobile,
  };
}

/** A fetch backed by Rust. Credentials are scoped to `baseUrl`'s origin. */
export function nativeFetch(invoke: Invoke, baseUrl: string, token?: string): typeof globalThis.fetch {
  const trusted = baseUrl ? new URL(baseUrl).origin : "";
  return async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    const headers = [...new Headers(init?.headers).entries()];
    if (token && trusted && new URL(url).origin === trusted) {
      headers.push(["Authorization", `Bearer ${token}`]);
    }
    const body = init?.body === undefined || init.body === null
      ? undefined
      : Array.from(new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer()));

    const response = await invoke("kenkui_request", {
      spec: { url, method: (init?.method ?? "GET").toUpperCase(), headers, body },
    }) as { status: number; headers: [string, string][]; body: number[] };

    return new Response(new Uint8Array(response.body), {
      status: response.status,
      headers: new Headers(response.headers),
    });
  };
}

function openEventChannel(invoke: Invoke): (url: string) => EventChannel {
  return (url) => {
    let onFrame: (frame: EventFrame) => void = () => undefined;
    let onError: () => void = () => undefined;
    const channel = new Channel<{ event: string; data: string }>();
    channel.onmessage = (frame) => onFrame({ type: frame.event, data: frame.data });
    void invoke("kenkui_events_open", { url, channel }).catch(() => onError());

    return {
      onFrame: (listener) => { onFrame = listener; },
      onError: (listener) => { onError = listener; },
      close: () => { channel.onmessage = () => undefined; },
    };
  };
}

export async function createHost(): Promise<Host> {
  const invoke = tauriInvoke as unknown as Invoke;
  const platform = await osPlatform();
  const can = hostCapabilitiesFor(platform);

  return {
    platform: can.reachLoopback ? "desktop" : "mobile",
    can,
    transport: (baseUrl) => ({
      fetch: nativeFetch(invoke, baseUrl),
      eventSource: channelEventSourceFactory(openEventChannel(invoke)),
    }),
    servers: await createNativeRegistry(),
    saveArtifact: async (blob, suggestedName) => { await saveBlob(blob, suggestedName, can); },
    openExternal: async (url) => { await openUrl(url); },
    onResume: (listener) => {
      // Desktop webviews stay resident, so visibilitychange is sufficient here.
      // Mobile replaces this with the platform lifecycle event at mobile release.
      const wake = () => { if (document.visibilityState === "visible") listener(); };
      document.addEventListener("visibilitychange", wake);
      return () => document.removeEventListener("visibilitychange", wake);
    },
  };
}
```

`createNativeRegistry`, `saveBlob`, and `openUrl` arrive in Task 11. To keep this task independently testable, add temporary implementations at the bottom of the file:

```ts
async function createNativeRegistry(): Promise<Host["servers"]> {
  throw new Error("The native server registry is not implemented yet.");
}
async function saveBlob(_blob: Blob, _name: string, _can: HostCapabilities): Promise<void> {
  throw new Error("Native artifact saving is not implemented yet.");
}
async function openUrl(_url: string): Promise<void> {
  throw new Error("Opening external links is not implemented yet.");
}
```

Install the OS plugin:

```bash
npm install @tauri-apps/plugin-os
cd src-tauri && cargo add tauri-plugin-os
```

Register it in `src-tauri/src/lib.rs`:

```rust
        .plugin(tauri_plugin_os::init())
```

and add `"os:default"` to the `permissions` array in `src-tauri/capabilities/default.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

Run: `cd src-tauri && cargo check`
Expected: compiles.

- [ ] **Step 5: Commit**

```bash
git add src/host/tauri.ts tests/tauri-host.test.ts src-tauri package.json package-lock.json
git commit -m "feat: add the native host transport

Tokens are attached in Rust and scoped to the selected server's origin, so
they never enter the webview's JS heap or reach a different server."
```

---

### Task 11: Native server registry and the `/servers` route

**Files:**
- Create: `src/pages/servers.tsx`, `tests/servers.test.tsx`
- Modify: `src/host/tauri.ts`, `src/router.tsx:1-10`, `src/app.tsx`

**Interfaces:**
- Consumes: `ServerRegistry` (Task 2), `Host` (Task 2).
- Produces: `ServersPage({ host, onSelect }: { host: Host; onSelect: () => void })`; `Route` union gains `"servers"`; `src/host/tauri.ts` gains a persisted registry, `saveBlob`, and `openUrl`.

- [ ] **Step 1: Write the failing test**

Create `tests/servers.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServersPage } from "../src/pages/servers";
import { fakeHost } from "./fakes/host";

const entries = [
  { id: "cloud", label: "Kenkui Cloud", baseUrl: "https://api.kenkui.example", kind: "cloud" as const },
  { id: "local", label: "Local", baseUrl: "http://127.0.0.1:7850", kind: "custom" as const },
];

describe("servers page", () => {
  it("lists known servers and selects one", async () => {
    const host = fakeHost({
      can: { chooseServer: true, reachLoopback: true, manageLocalServer: false, saveToPath: true },
    });
    host.servers.list = vi.fn().mockResolvedValue(entries);
    const onSelect = vi.fn();

    render(<ServersPage host={host} onSelect={onSelect} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use Local" }));

    await waitFor(() => expect(host.servers.select).toHaveBeenCalledWith("local"));
    expect(onSelect).toHaveBeenCalled();
  });

  it("surfaces a rejected server instead of adding it", async () => {
    const host = fakeHost({
      can: { chooseServer: true, reachLoopback: false, manageLocalServer: false, saveToPath: false },
    });
    host.servers.list = vi.fn().mockResolvedValue(entries);
    host.servers.add = vi.fn().mockRejectedValue(new Error("This device cannot reach a loopback address."));

    render(<ServersPage host={host} onSelect={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Server address"), {
      target: { value: "http://127.0.0.1:7850" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));

    await screen.findByText("This device cannot reach a loopback address.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/servers.test.tsx`
Expected: FAIL — cannot resolve `../src/pages/servers`.

- [ ] **Step 3: Write minimal implementation**

Create `src/pages/servers.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { Host, ServerEntry } from "../host/index";
import { ErrorMessage } from "../components/error-message";

interface ServersPageProps { host: Host; onSelect: () => void }

export function ServersPage({ host, onSelect }: ServersPageProps) {
  const [entries, setEntries] = useState<ServerEntry[]>();
  const [address, setAddress] = useState("");
  const [error, setError] = useState<unknown>();
  const refresh = () => { void host.servers.list().then(setEntries).catch(setError); };
  useEffect(refresh, [host]);

  const choose = async (id: string) => {
    try { await host.servers.select(id); onSelect(); } catch (cause) { setError(cause); }
  };
  const add = async () => {
    try { await host.servers.add(address); setAddress(""); refresh(); } catch (cause) { setError(cause); }
  };

  return <main><h1>Servers</h1><ErrorMessage error={error} />
    <ul>{entries?.map((entry) => <li key={entry.id}>
      {entry.label} <span>{entry.baseUrl}</span>
      <button type="button" onClick={() => void choose(entry.id)}>Use {entry.label}</button>
    </li>)}</ul>
    <label htmlFor="server-address">Server address</label>
    <input id="server-address" value={address} onChange={(event) => setAddress(event.target.value)} />
    <button type="button" onClick={() => void add()}>Add server</button>
  </main>;
}
```

In `src/router.tsx`, extend the union and add the path:

```ts
export type Route = { page: "jobs" | "new-job" | "job" | "billing" | "sign-in" | "servers"; jobId?: string };
```

and inside `parseRoute`, before the final return:

```ts
  if (pathname === "/servers") return { page: "servers" };
```

In `src/app.tsx`, render it behind the capability:

```tsx
{route.page === "servers" && host.can.chooseServer && <ServersPage host={host} onSelect={() => navigate("/jobs")} />}
```

In `src/host/tauri.ts`, replace the three temporary throwing functions:

```ts
import { load } from "@tauri-apps/plugin-store";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { openUrl as openExternalUrl } from "@tauri-apps/plugin-opener";

const cloud: ServerEntry = {
  id: "cloud", label: "Kenkui Cloud", baseUrl: "https://api.kenkui.example", kind: "cloud",
};

function isLoopback(baseUrl: string): boolean {
  const host = new URL(baseUrl).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

async function createNativeRegistry(can: HostCapabilities): Promise<Host["servers"]> {
  const store = await load("servers.json", { autoSave: true });
  const read = async () => (await store.get<ServerEntry[]>("entries")) ?? [cloud];
  const write = async (entries: ServerEntry[]) => { await store.set("entries", entries); };

  return {
    list: read,
    selected: async () => {
      const entries = await read();
      const id = await store.get<string>("selected");
      return entries.find((entry) => entry.id === id) ?? entries[0];
    },
    select: async (id) => { await store.set("selected", id); },
    add: async (baseUrl, label) => {
      const url = new URL(baseUrl);
      if (!can.reachLoopback && isLoopback(baseUrl)) {
        throw new Error("This device cannot reach a loopback address.");
      }
      const probe = await nativeFetch(tauriInvoke as unknown as Invoke, url.origin)(`${url.origin}/v1/capabilities`);
      if (!probe.ok) throw new Error(`That server answered ${probe.status}.`);

      const entry: ServerEntry = { id: url.origin, label: label ?? url.host, baseUrl: url.origin, kind: "custom" };
      await write([...(await read()).filter((existing) => existing.id !== entry.id), entry]);
      return entry;
    },
    remove: async (id) => { await write((await read()).filter((entry) => entry.id !== id)); },
  };
}

async function saveBlob(blob: Blob, name: string, can: HostCapabilities): Promise<void> {
  if (!can.saveToPath) throw new Error("This device cannot save to a chosen path.");
  const path = await save({ defaultPath: name });
  if (!path) return;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}

async function openUrl(url: string): Promise<void> { await openExternalUrl(url); }
```

Update the `createHost` call sites to pass `can`: `servers: await createNativeRegistry(can)`.

Install the plugins:

```bash
npm install @tauri-apps/plugin-store @tauri-apps/plugin-dialog @tauri-apps/plugin-fs @tauri-apps/plugin-opener
cd src-tauri && cargo add tauri-plugin-store tauri-plugin-dialog tauri-plugin-fs tauri-plugin-opener
```

Register each in `src-tauri/src/lib.rs` with `.plugin(tauri_plugin_store::Builder::default().build())` and the `::init()` form for the rest, then add `"store:default"`, `"dialog:default"`, `"fs:default"`, and `"opener:default"` to `src-tauri/capabilities/default.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

Run: `npx tsc --noEmit && cd src-tauri && cargo check`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/pages/servers.tsx src/router.tsx src/app.tsx src/host/tauri.ts tests/servers.test.tsx src-tauri package.json package-lock.json
git commit -m "feat: let the native app choose and persist its server

Adding a server is validated by the same GET /v1/capabilities the app
already makes at boot, so connection testing adds no new surface."
```

---

### Task 12: PKCE scaffold

Interface and fake-server tests only. It cannot be exercised: no Cloud server is deployed, and `Capabilities.auth` exposes no issuer or endpoints. See spec §5.

**Files:**
- Create: `src-tauri/src/auth.rs`, `tests/pkce.test.ts`, `src/host/pkce.ts`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `challengeFrom(verifier: string): Promise<string>` and `randomVerifier(): string` from `src/host/pkce.ts`; Rust `verifier_is_valid(verifier: &str) -> bool`.

- [ ] **Step 1: Write the failing test**

Create `tests/pkce.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { challengeFrom, randomVerifier } from "../src/host/pkce";

describe("pkce", () => {
  it("produces a verifier within the RFC 7636 length bounds", () => {
    const verifier = randomVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("derives the documented S256 challenge for the RFC example verifier", async () => {
    await expect(challengeFrom("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
      .resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pkce.test.ts`
Expected: FAIL — cannot resolve `../src/host/pkce`.

- [ ] **Step 3: Write minimal implementation**

Create `src/host/pkce.ts`:

```ts
const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 code verifier: 43-128 unreserved characters. */
export function randomVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return Array.from(bytes, (byte) => unreserved[byte % unreserved.length]).join("");
}

/** RFC 7636 S256 challenge. */
export async function challengeFrom(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}
```

Create `src-tauri/src/auth.rs`:

```rust
/// RFC 7636 restricts the verifier to 43-128 unreserved characters.
pub fn verifier_is_valid(verifier: &str) -> bool {
    let length = verifier.chars().count();
    (43..=128).contains(&length)
        && verifier
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-._~".contains(character))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_conforming_verifier() {
        assert!(verifier_is_valid("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
    }

    #[test]
    fn rejects_a_short_verifier() {
        assert!(!verifier_is_valid("too-short"));
    }

    #[test]
    fn rejects_reserved_characters() {
        assert!(!verifier_is_valid(&"a".repeat(42).to_string().replace('a', "!")));
    }
}
```

Add `pub mod auth;` to `src-tauri/src/lib.rs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test && cd src-tauri && cargo test`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/host/pkce.ts src-tauri/src tests/pkce.test.ts
git commit -m "feat: scaffold PKCE challenge generation

Interface and tests only. No Cloud server is deployed and
Capabilities.auth exposes no endpoints, so the flow is not exercisable."
```

---

### Task 13: Mobile scaffold, macOS build, and smoke checklist

**Files:**
- Create: `docs/native-smoke-checklist.md`
- Modify: `src-tauri/tauri.conf.json` (bundle targets), `.gitignore`

**Interfaces:**
- Consumes: everything above.
- Produces: a running macOS app and a written manual verification procedure.

- [ ] **Step 1: Write the failing test**

The deliverable is an app that launches, so the test is the smoke checklist. Create `docs/native-smoke-checklist.md`:

```markdown
# Kenkui Studio native smoke checklist

Run against a local `kenkui-server` on `http://127.0.0.1:7850`.
Automated native E2E is deliberately out of scope this milestone (spec §7).

- [ ] App launches and shows the server picker or the jobs list.
- [ ] Adding `http://127.0.0.1:7850` succeeds and persists across a restart.
- [ ] Adding an unreachable address shows an error and is not persisted.
- [ ] The jobs list renders server state.
- [ ] Creating a job from an EPUB reaches `Status: succeeded`.
- [ ] Progress updates arrive live, proving SSE over the Rust channel works.
- [ ] Killing the server mid-job surfaces an error rather than hanging.
- [ ] "Download M4B" opens a native save dialog and writes a playable file.
- [ ] The window's devtools network panel shows **no** requests: all traffic is in Rust.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run tauri dev`
Expected: FAIL initially if icons or plugin permissions are incomplete. Fix what the error reports, then proceed.

- [ ] **Step 3: Write minimal implementation**

Initialize the mobile projects so their configuration is committed and buildable:

```bash
npm run tauri ios init
npm run tauri android init
```

If the Xcode or Android SDK toolchains are absent, **stop and record that in the commit message** rather than installing them — mobile is scaffolded, not released, and the toolchains are not a prerequisite for this milestone.

Add generated mobile build output to `.gitignore`:

```
src-tauri/gen/apple/build/
src-tauri/gen/android/app/build/
```

Build the macOS app:

```bash
npm run tauri build
```

Work through `docs/native-smoke-checklist.md` against a running local server and tick each box.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test && npx tsc --noEmit && cd src-tauri && cargo test`
Expected: all PASS.

Confirm every checklist box is ticked. **Record only what you actually ran.** Do not claim Windows or Linux support; no machine built them.

- [ ] **Step 5: Commit**

```bash
git add docs/native-smoke-checklist.md src-tauri .gitignore
git commit -m "feat: scaffold mobile targets and verify the macOS build

Mobile projects are committed but unreleased. macOS is the only platform
this milestone exercised, so it is the only one claimed."
```

---

## Change Set 2: `kenkui-server`

**This executes in a different repository** (`/Users/dizzler/Projects/Repos/kenkui-v2/kenkui-server`) on its own branch. It is independent of Tasks 1-13: the native app routes through Rust and needs no CORS. CORS is required for the browser build against the `app.*`/`api.*` split in `specs/04 §14`.

### Task 14: CORS and fixture paths in `kenkui-server`

**Files:**
- Modify: `src/kenkui_server/config.py:14`, `src/kenkui_server/app.py:122`, `tests/test_beta_integration.py:16`, `tests/test_real_render.py:16`
- Test: `tests/test_local_api.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `create_app(allowed_origins: list[str] | None = None)`; `KENKUI_ALLOWED_ORIGINS` config; fixture paths that honor `KENKUI_WEB_ROOT`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_local_api.py`:

```python
def test_allows_configured_cross_origin_clients(tmp_path):
    """A browser served from a different origin must be able to call /v1."""
    with TestClient(create_app(data_dir=tmp_path / "state", allowed_origins=["https://app.kenkui.example"])) as client:
        response = client.get("/v1/capabilities", headers={"Origin": "https://app.kenkui.example"})

    assert response.headers["access-control-allow-origin"] == "https://app.kenkui.example"


def test_omits_cors_headers_when_no_origins_are_configured(tmp_path):
    """A loopback-only server stays closed by default."""
    with TestClient(create_app(data_dir=tmp_path / "state")) as client:
        response = client.get("/v1/capabilities", headers={"Origin": "https://evil.example"})

    assert "access-control-allow-origin" not in response.headers
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dizzler/Projects/Repos/kenkui-v2/kenkui-server && .venv/bin/python -m pytest tests/test_local_api.py -v`
Expected: FAIL — `create_app()` has no `allowed_origins` parameter.

- [ ] **Step 3: Write minimal implementation**

In `src/kenkui_server/app.py`, add the parameter to `create_app` alongside `web_build_path`, and after the app is constructed:

```python
    if allowed_origins:
        from fastapi.middleware.cors import CORSMiddleware

        app.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
            allow_headers=["Content-Type", "Idempotency-Key", "Authorization"],
        )
```

Default to `None` so a loopback server stays closed. In `src/kenkui_server/config.py`, add `allowed_origins: list[str] = []` and populate it from `KENKUI_ALLOWED_ORIGINS` (comma-separated), then pass it through in `main.py`.

In both `tests/test_beta_integration.py:16` and `tests/test_real_render.py:16`, replace the hardcoded sibling path:

```python
WEB_ROOT = Path(os.environ.get("KENKUI_WEB_ROOT") or Path(__file__).resolve().parents[2] / "kenkui-web")
SOURCE = WEB_ROOT / "tests/fixtures/book.epub"
```

Add `import os` where missing. This keeps those tests working both before and after the directory rename in change set 4.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/dizzler/Projects/Repos/kenkui-v2/kenkui-server && .venv/bin/python -m pytest -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dizzler/Projects/Repos/kenkui-v2/kenkui-server
git checkout -b cors-and-portable-fixtures
git add src/kenkui_server tests
git commit -m "feat: allow configured cross-origin clients

Needed for the app.*/api.* split in specs/04 section 14. Closed by
default, so a loopback server is unaffected. Fixture paths now honor
KENKUI_WEB_ROOT so they survive the kenkui-studio rename."
```

---

## Deferred to a follow-up plan

Change sets 3 and 4 from spec §8 — the spec amendments and the `kenkui-web` → `kenkui-studio` directory rename — require both agents idle and are **not** part of this plan. Attempting the rename while another session is working in the main checkout will break that session's working directory. See spec §9, step 5.
