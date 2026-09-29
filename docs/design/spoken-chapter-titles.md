# Spoken chapter titles

Implemented locally across core, server, and Studio, 2026-09-27. Deployment is separate.

## Behavior

Enable **Speak chapter titles** by default for new Studio drafts, new API requests, and new core synthesis pipelines; provide an opt-out control. Use the selected logical chapter's title and the narrator voice, including in character narration mode. Announce it before any epigraph or body text. Keep existing saved drafts and persisted jobs off when the setting is absent.

Show the resolved announcements before submission. Permit per-chapter exclusion and a spoken-text override so readers can exclude front matter, correct abbreviations, or handle titles that differ from printed headings. Overrides affect speech only; navigation titles stay independent. Use stable chapter IDs, not selection positions, so selecting Chapters 10–12 never renumbers them.

Automatically reuse a matching opening body heading instead of adding another copy. Match conservatively after whitespace, Unicode, and case normalization; do not assume Roman numerals and Arabic numerals are interchangeable. Compare only the opening heading, never an arbitrary epigraph credit or later subsection. Ambiguous matches remain visible in the review and can be excluded manually. Do not remove or rewrite source text. Reusing a heading means retaining its source speech and applying the opening-title boundary policy once.

Record title provenance in inspection (authored navigation, opening heading, document title, generated fallback). Exclude generated labels such as `Untitled section N` from automatic announcements unless the reader supplies explicit spoken text. Older inspections without provenance need a new inspection for reliable automatic resolution; do not guess from label spelling alone. Existing jobs remain readable and runnable with their saved behavior.

## Silence and chapter markers

Example with a 1,500 ms chapter pause and a 750 ms title pause:

```text
Previous chapter's final words
  → 1,500 ms existing chapter gap
  → [next chapter marker] “Chapter twelve”
  → 750 ms title gap
  → epigraph / opening body text
```

The 750 ms default is a listening-test starting point, not a measured optimum.

- Preserve the existing inter-chapter boundary and manual-silence precedence. Do not add another heading-before gap before an inserted announcement.
- Add `chapterTitlePauseMs` as the explicit pause after an announcement. At that same boundary, combine applicable automatic paragraph/heading/scene pauses by maximum, not addition. Explicit user silence overrides retain priority. Source boundaries deeper in the body retain their existing behavior.
- For a reused opening heading, resolve its trailing boundary with the same policy. It must not receive both an independent title gap and an independent heading gap.
- No leading gap before the first selected chapter and no trailing gap after the final spoken segment, including a title-only chapter. An excluded announcement adds no title gap.
- A chapter marker begins on the announcement (or reused opening heading), after the preceding chapter gap. The announcement belongs to the same chapter ID as its body.
- Derive marker timestamps from rendered PCM frame counts as today. Extra speech and title gaps increase total duration and shift subsequent timestamps; existing configured silence lengths do not drift.

The configured values describe inserted silence. A TTS segment may also contain natural leading/trailing quiet; audible pacing needs a listening test. This feature should not introduce a global silence-trimming change.

## Core implementation

Introduce an immutable announcement operation and a shared pure resolver. Its per-chapter result identifies omitted, inserted, or reused-source speech, the exact text, and any source heading range. Use the same resolver for preview, quoting, and compilation.

Do not prepend text to `ChapterInspection.text`. Character attribution, selections, annotations, and scoped pronunciation/silence rules reference canonical source offsets. Instead, extend plan segment provenance to distinguish generated announcements from source ranges; do not pretend generated text occupies a source offset. Audit every consumer of segment origins, grid mappings, and source-character accounting.

In `_compile_segments`, emit inserted narrator segment(s) before the existing body segments, then assign the title boundary once. Long titles follow normal TTS length limits; the title pause belongs after the last title segment. Reused headings stay source-backed and resolve to narrator speech when the feature is enabled. Preserve body content and voice attribution elsewhere.

Apply normal language-aware speech preparation and pronunciation to announcement text. Number pronunciation must be validated, especially Roman numerals; the spoken-text override provides an explicit correction when needed.

Include resolved announcement text, policy, and provenance in plan identity. Ensure generated-segment identity cannot collide with source segments. Audit ordinal-dependent cache keys before promising body-audio reuse. Pause values remain outside synthesis identity, following the existing `trailing_silence_ms` design, so changing only the title pause does not require resynthesizing speech. Update affected plan/checkpoint schema versions and preserve old stored-job semantics.

Relevant existing paths: core `_domain/planning.py` (`SpeechSegment`, `_SegmentSource`, `_compile_segments`, `_gap_ms`), `inspection.py`, EPUB chapter construction, and `_audio/production.py` (frame-derived metadata).

## Server and Studio

API fields: `tts.speakChapterTitles`, `tts.chapterTitlePauseMs`, and per-chapter announcement overrides/exclusions. Validate text lengths, pause bounds, and chapter ownership/selection. Advertise support through capabilities; Studio must not silently submit enabled settings to an older server.

Persist the settings in the server's immutable job specification, feed them through its pipeline adapter, regenerate OpenAPI and Studio types, and preserve the fields across draft save/reload and job recreation. Update Studio speech controls and review with the resolved announcement preview and title pause. Hide the additional pause field while the feature is off.

Use resolved added speech in server-side quote/reservation, limits, progress, and actual usage reconciliation, according to each existing accounting convention. Reused source headings must not be counted twice. Studio chapter/duration estimates must disclose and include added announcements. The source inspection's body character count remains a source count, not a mutable render total.

## Delivery and acceptance

1. Implement the resolver, provenance, compilation, and boundary tests in core.
2. Add server validation, persisted settings, capability, quoting, and preview support.
3. Add Studio controls, review, generated types, and backward-compatible draft defaults.
4. Render a small Dune selection and a fixture with existing opening headings; listen before choosing the default title gap.

Test off-mode compatibility; TOC-only titles; duplicate opening headings; epigraphs; generated fallback labels; overrides/exclusions; character-mode narrator assignment; long and title-only chapters; partial selections; manual silence precedence; and checkpoint invalidation. Use known-length PCM to assert exact inserted gaps, total duration, and chapter markers. Verify that a pause-only edit reuses synthesized audio and that billing adds each generated announcement exactly once.

Completed audiobooks remain unchanged. Producing spoken announcements for an existing audiobook requires new audio assembly and regenerated timestamps, even if compatible cached body speech can be reused. A metadata-only repair cannot add spoken words.

## Implementation notes

Core exposes `Pipeline.chapter_titles(enabled=True, pause_ms=750, overrides=...)` and `resolve_chapter_titles(inspection, ...)`. Calling `tts()` supplies the enabled policy unless explicitly configured. `None` overrides exclude a chapter. Generated segments have `source_kind="chapter_title"` and a separate identity namespace. Existing source selections still use canonical offsets; a partial selection that omits the opening does not receive an announcement.

The server advertises `spokenChapterTitles`, returns `chapterAnnouncements` and `addedTitleCharacters` in preflight, and includes added canonical characters in reservations and limits. Fresh inspection supplies provenance without mutating stored source counts. Persisted jobs missing the setting reconstruct an explicitly disabled core policy. Studio sends explicit choices and blocks enabled settings on unsupported servers.

New announcements shift segment ordinals, so switching announcements on/off does not promise reuse of old body audio. Changing only the title pause preserves synthesis cache keys; a coordinator-level regression test verifies this. Core Script remains a source-text view; announcement preview is provided by the resolver and Studio preflight.
