# Kenkui Studio

Browser client for the sibling `kenkui-server` API. All ebook processing runs
through the server and the Kenkui library.

The same frontend also has a Tauri desktop shell and mobile integration in progress. Native support is under
development; see [native setup](docs/setup/native-development.md),
[mobile setup](docs/setup/mobile-development.md), and the
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

## Hosted deployment

Cloudflare Static Assets configuration is in `wrangler.jsonc`. Run
`npm run deploy:staging -- --dry-run` to build with the staging API origin and
validate deployment, then omit `--dry-run` to publish. Use `deploy:production`
for the production origin. See the server's `deploy/production.md` for the
complete release sequence and account prerequisites.
