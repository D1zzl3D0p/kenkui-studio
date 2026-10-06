# Kenkui Studio

Browser client for the sibling `kenkui-server` API. All ebook processing runs
through the server and the Kenkui library.

The same frontend also has a Tauri desktop shell and mobile integration in progress. Native support is under
development; see [native setup](docs/setup/native-development.md),
[mobile setup](docs/setup/mobile-development.md),
[CI test builds](docs/setup/native-ci.md), and the
[readiness backlog](docs/tauri-readiness.md).

```sh
npm ci
npm run dev
```

Vite proxies `/v1` to `http://127.0.0.1:8000`. Production defaults to the same
origin. For separate hosting, set `VITE_KENKUI_API_ORIGIN` at build time.
Hosted cookie sessions require HTTPS and web/API origins on the same site.

```sh
npm run generate:api
npm run check:api
npm test
npm run build
npm run test:e2e
```

API types are generated from `../kenkui-server/openapi/v1.json`. Regenerate the
server artifact first with `python -m kenkui_server.export_openapi` in its uv
environment. `src/api/generated/v1.ts` only aliases generated schemas.

Playwright uses a deterministic server fixture. The separate server real-render
acceptance test verifies synthesis and playable M4B output. For the complete
release checklist, see `../kenkui-server/deploy/README.md`.

## Desktop sidecar development

`sidecar/kenkui_sidecar.py` is the first development entry point for a managed
local server. It uses the installed `kenkui-server` package and its Python
environment; it does not bundle Python, models, or FFmpeg yet. From this repo:

```sh
../kenkui-server/.venv/bin/python sidecar/kenkui_sidecar.py --provision-voices --data-dir /absolute/path/to/sidecar-data
../kenkui-server/.venv/bin/python -m unittest discover -s tests/sidecar -p 'test_*.py' -v
```

Use the equivalent Python executable on Windows. The data directory contains
persistent server state and a `models/manifest.json` voice cache; use a dedicated
directory for development. The launcher defaults to **two simultaneous jobs,
with two render workers per job**. These limits multiply: higher values consume
more CPU and model memory. The tests do not download models or synthesize audio.

The desktop automatically provisions the same VCTK voice set selected by the
cloud server before starting the API. First startup requires internet access;
subsequent starts verify and reuse downloaded voices. Failed or cancelled
downloads can be retried by selecting **This computer** again. Progress appears
on the Servers page, where startup can also be stopped. The launcher sets
`KENKUI_POCKET_MANIFEST` for itself and its workers to keep downloads and rendering
on the same app-local cache. Direct CLI runs may omit `--provision-voices` for
an API-only smoke test; only already-loaded voices are then available.

Development configuration is supplied in Studio's launch environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `KENKUI_LOCAL_MAX_JOBS` | `2` | Simultaneous conversions, integer 1–8 |
| `KENKUI_LOCAL_RENDER_WORKERS` | `2` | Render workers per conversion, integer 1–8 |
| `OPENROUTER_API_KEY` | unset | Enables character casting using your OpenRouter account |
| `KENKUI_LOCAL_OPENROUTER_MODEL` | Server's `DEFAULT_CHARACTER_MODEL` | Optional `openrouter/…` character-model override |

The default character model is currently `openrouter/deepseek/deepseek-v4-flash`,
matching the cloud default. Without a nonblank key the server advertises only
single-voice casting. With a key it also advertises character casting and the
selected model; model calls are billed to that OpenRouter account. Supplying a
key enables the capability but does not validate the key or contact OpenRouter
until a conversion needs it. Restart Studio after changing its environment.
There is no key-entry UI yet. Keys are inherited by server workers, never placed
in launch arguments, browser storage, or readiness/progress messages.

For example, in Bash, prompt for the key without putting it in shell history:

```bash
read -r -s -p 'OpenRouter API key: ' OPENROUTER_API_KEY
export OPENROUTER_API_KEY
export KENKUI_LOCAL_MAX_JOBS=2 KENKUI_LOCAL_RENDER_WORKERS=2
KENKUI_SIDECAR_PYTHON="$(pwd)/../kenkui-server/.venv/bin/python" npm run desktop:dev
```

For direct launcher use, `--max-jobs`, `--render-workers`, and
`--openrouter-model` override their environment defaults. The API key is accepted
only through the environment. Account, credit, payment, and email services are
not enabled by this local configuration.

The parent process must keep stdin open, read stdout, and drain stderr. After
ASGI startup and socket binding complete, stdout emits a readiness JSON line:

```json
{"type":"ready","protocolVersion":1,"baseUrl":"http://127.0.0.1:49152","pid":12345}
```

Provisioning can first emit bounded progress messages such as
`{"type":"progress","protocolVersion":1,"pid":12345,"message":"Preparing voice 1 of 59: alasdair"}`.
Progress never makes the endpoint available; the supervisor waits for readiness.

The port is assigned by the OS and held continuously through startup. Binding
is always IPv4 loopback; no host or port override is accepted. Application and
worker stdout is redirected to stderr, keeping the control channel clean.
Close stdin to request graceful API shutdown (or send EOF when testing in a
terminal). A startup failure exits nonzero without readiness; a disconnected
readiness reader also triggers API shutdown. Uvicorn's graceful request-drain
timeout is ten seconds; this is not a total process shutdown deadline.

To enable the managed server in a desktop debug build, set an absolute Python
path before launching Studio:

```sh
KENKUI_SIDECAR_PYTHON="$(pwd)/../kenkui-server/.venv/bin/python" npm run desktop:dev
```

Choose **This computer** in the server picker. Rust supplies the entry point and
an OS-specific app-local data directory under `org.kenkui.studio/local-server`;
the webview cannot choose executable paths or arguments. The supervisor shares
one process across concurrent starts, allows startup cancellation, reports
crashes, and reaps the API process on stop or app exit. Startup has a 30-minute
deadline; shutdown closes stdin and allows 15 seconds before forcing termination.
Logs inherit Studio's stderr. The server page exposes status and a stop button.
Keep the virtual environment's executable path (do not resolve its symlink to
the system interpreter, which would lose the installed server environment).

Only the managed server ID is persisted as the selection. Its endpoint is
resolved from a new readiness message on every app launch, so an old ephemeral
port is never reused. A failed startup preserves the previous selection. The
desktop single-instance plugin prevents a second Studio from owning this data
directory; do not point a separately launched API at that directory.

Mobile and release builds keep this feature disabled, including when the
environment variable is set. Without the variable, desktop behavior is unchanged.
Run the supervisor and picker tests with:

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --lib sidecar
npx vitest run tests/native-registry.test.ts tests/servers.test.tsx
```

Rust lifecycle tests use `python3` (`python` on Windows); override with
`KENKUI_SIDECAR_TEST_PYTHON` if needed. They exercise process failures without
models or the server's dependencies.
To exercise the Rust supervisor against the actual server, including HTTP
readiness, shutdown, and a second launch with the same temporary data directory:

```sh
KENKUI_SIDECAR_TEST_PYTHON="$(pwd)/../kenkui-server/.venv/bin/python" \
  cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features \
  --test sidecar_local -- --ignored
```

This integration test performs no synthesis and leaves the development server's
data untouched.
Readiness follows [Uvicorn's startup lifecycle](https://www.uvicorn.org/concepts/lifespan/).

Desktop shutdown stops active conversions. The sidecar opts into the sibling
server's `stop_workers_on_close` policy: active workers receive cancellation,
then their process trees are stopped if they do not finish within the grace
period. Unstarted jobs stay queued. Each worker has a separate lightweight
supervisor watching a pipe held by the API, so forced API termination also
stops rendering and encoder children. POSIX uses worker process groups; Windows
uses a private [kill-on-close Job](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
Standalone server workers retain their existing survive-shutdown behavior.
This requires the companion changes in `kenkui-server`; an older server package
without the shutdown option fails startup rather than silently leaving workers running.

The process-tree tests can run without the server's Python dependencies:

```sh
python3 -m unittest discover -s tests/sidecar -p test_managed_workers.py -v
```

Before enabling it in desktop releases, add per-launch local authentication
and package the runtime and dependencies for each desktop platform. Frozen
packaging must also accommodate the server's current
`sys.executable -m kenkui_server.worker` invocation. The development API uses
the server's unauthenticated local mode with no allowed browser CORS origins.

## Hosted deployment

Cloudflare Static Assets configuration is in `wrangler.jsonc`. Run
`npm run deploy:staging -- --dry-run` to build with the staging API origin and
validate deployment, then omit `--dry-run` to publish. Use `deploy:production`
for the production origin. See the server's `deploy/production.md` for the
complete release sequence and account prerequisites.
