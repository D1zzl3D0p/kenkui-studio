# Kenkui Studio interaction prototype

Run from `kenkui-studio`:

```sh
npm run dev -- --host 0.0.0.0 --port 5174
```

Open `/prototype/`. For a remote server, forward port 5174:

```sh
ssh -L 5174:127.0.0.1:5174 USER@SERVER
```

Then open http://localhost:5174/prototype/. The Vite development server is intended for local/private preview access.

## Working interactions

- System/light/dark appearance: cocoa, linen and pale gold; animated transitions.
- EPUB filename or sample book entry; metadata editing and local cover upload (JPG/PNG/WebP, 2 MB).
- Resumable Book → Voices → Create workflow.
- Shared narrator with Single narrator / Full cast choices; editable illustrative character assignments, preserved across mode changes.
- Eight real voice recordings in the picker only; search and accent filter. Exclusive playback and an audio-driven Web Audio visualizer, with reduced-motion and analysis-unavailable fallbacks.
- Review-stage free example scene with single/full-cast recordings from `kenkui-site`. Switching recordings preserves relative position; examples do not represent user-selected cast assignments.
- Live credit estimate based on the default server pricing formula and clearly labeled fixture lengths.
- Demo wallet, insufficient-credit state, simulated checkout, transaction history, atomic reservation and cancellation release. Credit packs match current server packs.
- Simulated conversion progress and result playback/download of an existing example recording.
- Reset restores sample books and demo credits.

## Boundaries

No actual uploads, API calls, EPUB parsing, payments or synthesis. Input EPUB contents are not stored. Configuration, cover data and the demo ledger are saved locally under `kenkui-prototype-v2`; v1 drafts migrate when present. Uploaded books use an illustrative 500,000-character count and 18,000-character first chapter. Production must use server preflight, not this local quote function.

Custom book previews are explicitly unavailable until the server exposes preview generation and quoting. Example cast names are fixture data, not discovered from uploads. The current server advertises only M4B and always normalizes source text, so unsupported MP3 and normalization-toggle controls have been removed.

All changes remain under `prototype/` and `docs/design/`. The existing application and marketing site are not changed. This entry is not part of the normal production build.

## Audio provenance

Voice metadata comes from `kenkui-voices/voices.json`. Recordings are copied from `kenkui-site/public/audio/voices` or the catalog's pinned Hugging Face revision; fetched WAVs were SHA-256 verified. Scene recordings come from `kenkui-site/public/audio/samples`. WAV playback copies are decoded from the existing AAC files for browsers without AAC support; no synthesis is performed. No recordings are relabeled as personalized output.

## Verification

`node prototype/check.mjs` exercises real audio analysis, playback exclusivity, reduced motion, draft/cast restoration, cover upload, settings-driven quotes, insufficient balance, simulated pack purchase, reservation/release/completion, sample download, search, dialog dismissal and responsive layouts at 320/390/768/1440 px. Requires Playwright Chromium and its host dependencies.

On this headless server, an extracted ALSA library is available temporarily:

```sh
LD_LIBRARY_PATH=/tmp/kenkui-browser-libs/usr/lib node prototype/check.mjs
```

Type-check the independent prototype:

```sh
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --jsx react-jsx --moduleResolution bundler --module esnext --target es2022 --resolveJsonModule --allowSyntheticDefaultImports prototype/main.tsx
```
