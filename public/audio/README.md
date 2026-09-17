# Kenkui voice previews

The 47 named voice-pack previews are existing synthesized recordings from the
Kenkui voice pack, using the text recorded in `src/studio/voice-catalog.json`.
Their WAV files match the checksums in `kenkui-voices/voices.json`, asset revision
`1e47a137edc9cb1a5aaf0613a4e6b76bb1305455`. WAV provides consistent browser codec support.

The 12 built-in VCTK voices use the original reference recordings selected in
`kenkui/src/kenkui/voices/builtin.json`. The picker labels these **Reference recording**;
they are not synthesized narration. Their source URLs and SHA-256 hashes are
recorded in the catalog, pinned to `kyutai/tts-voices` revision
`323332d33f997de8394f24a193e1a76df720e01a`.

The catalog's `serverId` maps each preview to the short ID returned by the hosted
API; the original long IDs continue to resolve for older/local servers.

Samples are derived from the CSTR VCTK Corpus via Kyutai/Kenkui, under CC BY 4.0.
The voice picker displays attribution and license links:

- Corpus: https://datashare.ed.ac.uk/handle/10283/3443
- License: https://creativecommons.org/licenses/by/4.0/

The older M4A assets and recorded Pride and Prejudice scene clips remain available
at their existing URLs. Preview & create no longer displays the comparison card.
