# Desktop Cloud authentication

The desktop host owns sign-in, refresh and sign-out. The React UI sends actions
and the selected server origin across IPC; tokens are not returned to JavaScript.
The implementation also requires the accompanying `kenkui-server` changes.

## Enable on a server

1. Register `http://127.0.0.1:43827/callback` as an additional allowed redirect URI
   for the server's WorkOS application. Keep the existing browser callback URI.
   See the [WorkOS authorization reference](https://workos.com/docs/reference/authkit/authentication/get-authorization-url).
2. Set `KENKUI_NATIVE_REDIRECT_URI=http://127.0.0.1:43827/callback` in the server
   deployment. Leave `WORKOS_REDIRECT_URI` pointing at the browser callback.
   Without the new setting, native auth endpoints return 404.
3. Deploy the updated server with its existing WorkOS configuration, invitation
   allowlist and session encryption key. No new app-side WorkOS secret is needed.
4. Build/run Studio against that HTTPS server. The built-in Cloud entry can be
   changed through `VITE_KENKUI_NATIVE_API_ORIGIN`.

No server deployment or WorkOS configuration was changed during implementation.

## Flow and credential handling

- Rust validates the server origin, loads native auth configuration and binds
  the fixed callback port on IPv4 loopback before opening the system browser.
- Each attempt gets a fresh random state and S256 PKCE verifier/challenge. Only
  the challenge and state go to the authorization URL. The verifier stays in Rust.
- The callback must match the path, Host header and state, and contain exactly
  one code. Invalid callbacks do not consume the attempt. Attempts time out after
  three minutes; the UI can cancel them or switch servers.
- The server exchanges the code through WorkOS, checks verified email and the
  existing invitation allowlist, and returns a sealed WorkOS session for API
  access plus a separate refresh token. The sealed access credential stays in
  Rust memory. The refresh token is saved in macOS Keychain, Windows Credential
  Manager or Linux Secret Service, under a key derived from the exact origin.
- The existing server session verifier validates native bearer requests without
  silently refreshing them. Rust handles refresh explicitly, ahead of expiry or
  once following a 401. A per-origin lock prevents concurrent refresh rotation.
  The desktop shell permits one app instance to own that rotation.
- Both HTTP and SSE use the same native authentication helper. Credentials are
  attached only to the matching HTTPS origin's `/v1/` API. Rust refuses
  JavaScript-supplied Authorization/Cookie headers and does not follow redirects.
- Invalid/revoked refresh credentials are deleted. Network/provider failures keep
  saved credentials so an outage does not sign the user out permanently. A locked
  or unavailable credential store produces an error; there is no plaintext fallback.
- Sign-out deletes the stored refresh token and memory session, and attempts to
  revoke the provider session. Local sign-out works offline; remote revocation is
  best effort, and already-issued access credentials retain normal provider expiry
  semantics. Browser cookies and native credentials are separate sessions.
- Native credential responses, errors and validation failures are non-cacheable.
  Validation errors do not echo submitted refresh tokens or PKCE material.

## Server contract

All endpoints are relative to the selected HTTPS origin. They are available only
with a browser/WorkOS backend and the native redirect setting enabled.

| Endpoint | Request | Response |
| --- | --- | --- |
| `GET /v1/auth/native/config` | None | `{ redirectUri }` |
| `GET /v1/auth/native/authorize` | Query: `state`, `code_challenge` | 303 to WorkOS; fixed configured redirect |
| `POST /v1/auth/native/exchange` | JSON: `code`, `codeVerifier` | `{ accessToken, refreshToken, expiresIn, userId }` |
| `POST /v1/auth/native/refresh` | JSON: `refreshToken` | Rotated credentials in the same response shape |
| `POST /v1/auth/native/logout` | Bearer sealed session | 204 after provider revocation |

`accessToken` is the server-sealed WorkOS session accepted by the existing bearer
authentication path. It is not the raw WorkOS JWT. `expiresIn` is a refresh hint
derived from the trusted SDK result; actual authorization still validates the
session through WorkOS's verifier. Invalid provider credentials return 401,
invitation failures 403, and transient provider failures 503.

## Verification and remaining work

```sh
npm test
npm run build:web
npm run build:native
npm run test:native
```

`test:native` runs the real Rust auth/HTTP/SSE core without compiling the desktop
WebView shell. It uses in-memory credential storage and local HTTP fixtures;
tests do not contact WorkOS or access a real user keychain. The default Cargo
features still build the complete Tauri application.

On a configured desktop, verify invited and rejected sign-in, cancellation,
occupied callback port, restart restoration, refresh under concurrent HTTP/SSE
requests, server switching, offline sign-out and locked credential storage.
Reopening the app while it is running should focus the existing instance.

The implementation environment ran the core tests but could not compile the
desktop shell because GLib/GObject/WebView system dependencies were absent.
Live WorkOS login and real OS credential storage remain unverified.

Android/iOS native callbacks and secure storage are a separate next stage; mobile
currently reports that native sign-in is unavailable. Large-file streaming and
mobile export/lifecycle support remain outstanding.
