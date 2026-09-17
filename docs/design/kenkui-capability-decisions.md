# Kenkui capability decisions for Studio

Audited 2026-09-17 against the local Kenkui, server, and Studio checkouts. These are proposed product decisions for discussion, not implemented behavior. The scope is Kenkui's supported public API, including its configuration parameters, rather than private implementation functions or every possible engine option.

## Implemented scope

The approved first slice implements chapter pauses (1.5 seconds, on), conservative number preparation (on), built-in pronunciation corrections (on), and stutter handling (off). New Studio drafts receive these defaults on servers advertising `speechSettings`; existing drafts and durable jobs retain their prior behavior. All four controls are independent. Elongation, heading/paragraph/line pauses, and every other proposed addition remain deferred. The tables below retain the broader proposal for future discussion.

### Follow-up: editable pause lengths

The user subsequently requested text entry for every supported structural pause. Studio now replaces the chapter toggle with five millisecond fields: between chapters, before headings, after headings, between paragraphs, and between lines. New drafts start at 1500/0/0/0/0. Each value must be a whole number from 0 to 60,000; zero disables the added pause. The API advertises `pauseLengths`, accepts explicit durations, and preserves the legacy chapter toggle when no explicit chapter duration exists. Speech preparation remains unchanged. This supersedes the toggle-only pacing recommendations below.

## Decision rules

- **Automatic**: Studio/server handles this with a defined policy; no new setting.
- **Toggle**: expose one understandable on/off choice with fixed behavior, not numeric inputs or technical parameters.
- **Hidden**: do not expose or automatically activate this optional capability in this iteration. Infrastructure functions may still run internally where needed.
- **Existing**: preserve an existing user action or field. Uploading a book, choosing a voice, and editing a title cannot usefully become toggles.

Defaults below are proposals. Timing and speech-transformation defaults require listening validation before release. Hidden capabilities can be reconsidered later as complete workflows.

## Main finding: chapter pauses

The server's `jobs/pipeline.py` calls neither `pauses()` nor `pronounce()`. Kenkui's five structural pause durations default to zero. Studio therefore requests no explicit chapter separation, although the synthesizer may produce its own incidental silence.

Propose **Pause between chapters**, on by default, mapping to `chapter_ms=1500`; off maps to zero. Place it in an expandable **Pacing** section in Voices, available for both narration modes. Show the effective setting in Create. No duration slider.

Kenkui already places a chapter gap at the end of the preceding chapter, omits final trailing silence, and takes the longest overlapping structural pause rather than summing them. Changing chapter pause duration does not change speech segmentation. Cache reuse still depends on the server retaining the audio: it must not be advertised as free editing of completed jobs.

The 1.5-second value is a listening-test starting point, not a verified optimum. Compare 1, 1.5, and 2 seconds across chapter endings and chapter headings before settling it.

## Pacing: every `pauses()` parameter

| Capability | Decision | Proposed behavior | Reason |
| --- | --- | --- | --- |
| `chapter_ms` | Toggle, on | 1500 ms; off = 0 | Clear chapter separation is a baseline listening need. |
| `heading_after_ms` | Automatic | 500 ms | Give a spoken heading room before the body text; validate against EPUB heading detection. |
| `heading_before_ms` | Hidden, off | 0 | Chapter separation already handles many title boundaries; avoid another setting initially. |
| `paragraph_ms` | Toggle, off | “Extra pause between paragraphs”; on = 250 ms | Helpful for some material, but uniform extra silence may make dialogue drag. |
| `line_ms` | Hidden, off | 0 | Source line boundaries need not represent intended listening breaks. |
| `silence(duration_ms, where=...)` | Hidden | No manual per-passage silence editor | Requires selecting and reviewing actual passages, not just a switch. |

The chapter switch controls inserted chapter gaps, not all silence from heading policy or the voice engine. Copy should say “Adds a 1.5-second gap between chapters.”

## Speech shaping: every `pronounce()` setting

These are currently absent from the server contract. Kenkui's pronunciation stage is English-only and bypasses non-English narrator voices. Hide inapplicable controls and explain an inactive saved choice if the voice changes.

| Capability | Decision | Proposed behavior | Reason |
| --- | --- | --- | --- |
| Intrinsic source normalization | Automatic, already active | Unicode and whitespace normalization | Mandatory parsing behavior; remove the deprecated API toggle only through a compatible migration. |
| `numbers` | Toggle, on | “Prepare numbers for narration”; on = `conservative`, off = `off` | Provides a conservative, reversible choice without four technical tiers. |
| `currency`, `percent`, `ordinals`, `units`, `decimals`, `integers` | Automatic within number toggle | Follow conservative preset | No separate checkbox per numeric syntax. |
| `years`, `clock`, `roman` | Hidden, off | Do not enable standard-tier inference | Context-dependent readings deserve more evidence before becoming defaults. |
| `fractions`, `numbered`; aggressive bare Roman reading | Hidden, off | No aggressive preset | Too much interpretation for an automatic baseline. |
| `builtin` / `builtin_lexicon()` | Toggle, on | “Use pronunciation corrections”; fixed built-in dictionary | Replacements can be unwanted for some books, so allow opting out. |
| `elongation` | Automatic, on | Join hyphenated held sounds | A narrow repair for letter-by-letter rendering; audition representative cases. |
| `stammer` | Toggle, off | “Improve stuttered dialogue” | `D-day` and `S-shaped` can be mistaken for stammers; do not silently rewrite them. |
| `lexicon` / `read_lexicon()` | Hidden | No custom dictionary editor/import in this iteration | Needs word/replacement editing, validation, and an audition workflow. |
| Scoped `where=` pronunciation | Hidden | No passage-specific pronunciation rules | Needs a text-selection editor. |

Specify all chosen pronunciation flags explicitly when building a job; calling bare `pronounce()` also enables stammer handling, contrary to this proposal. Turning off both visible preparation switches does not disable intrinsic normalization or the proposed elongation repair. Labels must describe their individual effects.

## Book, narration, and continuity

| Public function / parameter | Decision | Studio treatment |
| --- | --- | --- |
| `book()`, `epub()`, `Source` | Existing upload; automatic construction | Continue inspecting uploaded EPUBs. |
| `select_chapters()` | Existing | Keep chapter checkboxes, default all selected. |
| `select_chapter_range()` | Hidden as a separate control | Existing selection can represent a contiguous range. |
| `select(*patterns)` | Hidden | No paragraph/line/sentence/phrase selection syntax in the composer. |
| `metadata(title, author)` | Existing | Import source values and retain editable fields. |
| `metadata(cover="source")` | Existing toggle, on | Include source cover by default. |
| `metadata(cover=path)` | Existing upload | Keep current cover replacement workflow. |
| `assign_voice()` | Existing | Narrator picker. |
| `assign_voices(narrator=...)` | Existing | Keep single-narrator/full-cast choice and narrator picker. |
| `assign_voices(unknown=...)` | Existing | Default to narrator; retain fallback voice override. |
| `assign_voices(method=...)` | Existing | Keep current match-character/any-voice choice; no new options. |
| `assign_voices(cast=...)` | Hidden for now | API already accepts character-to-voice mappings; Studio lacks roster discovery/review needed to make this usable. |
| `infer_characters(model=...)` | Automatic in full cast | Server orchestrates discovery using its supported model policy. |
| `infer_characters(identity=...)` | Hidden; preserve server's `None` | Do not add another model call or user switch for alias reasoning without evaluating quality and cost. |
| `attribute_quotes(model)` | Automatic in full cast; existing model choice | Preserve allowlisted model selection already in Studio. |
| `with_characters(roster)` | Hidden | Character name, alias, gender, add/remove corrections need a dedicated review workflow. |
| `attribute(character_id, where=...)` | Hidden | Passage speaker corrections need a script editor. |
| `series(series_id, book=...)` | Hidden for now | Series membership cannot safely be guessed or expressed by a toggle alone. Needs explicit series selection and account-scoped storage. |
| `series(allow_recast, allow_narrator_change)` | Hidden; false | Keep continuity protections; later expose deliberate changes inside a series workflow. |
| `list_series()` | Hidden | No new series browser in this iteration. |
| `remove_series()` | Hidden | Keep destructive continuity reset out of the composer. |

“Hidden for now” deliberately defers useful editing workflows. It does not imply these features are low value or that full API parity has been achieved.

## Review, execution, and storage

| Public function / parameter | Decision | Studio treatment |
| --- | --- | --- |
| `inspect()` | Automatic | Populate book metadata and chapters; deeper roster/casting details stay internal for now. |
| `validate()` | Automatic | Surface actionable validation; no validation enable/disable switch. |
| `resolve(until="characters" or "casting")` | Automatic when required | No user choice of pipeline checkpoint. Separate paid analysis/review workflow deferred. |
| `script()`; `Script.at()`, indexing, iteration | Hidden | Back a future passage-review interface, not a technical data dump. |
| `Script.warnings`, `materialized` | Automatic warnings / hidden cache detail | Explain relevant problems if this workflow is added; do not expose cache state. |
| `preview()` | Hidden from this settings iteration | A future “Preview this passage” action, with explicit cost, selection, and cache policy. Existing recorded examples remain labelled as examples. |
| `annotations()` | Hidden | No implicit sidecar import from uploaded files. |
| `write_annotations()` | Hidden | No annotation export until there is an editing/import workflow. |
| `tts()` | Automatic | Conversion necessarily synthesizes speech. |
| `write()`, `write_m4b()` | Existing Create/download action | Server owns publication; local library full-book writer is M4B. |
| `write(..., workers=...)`; preview workers | Hidden, server-managed | Resource scheduling is an operator concern. |
| `write(..., overwrite=...)`; preview overwrite/output path | Hidden, server-managed | Do not expose server filesystem behavior. |
| `write(..., keep_audio_cache=...)` | Hidden, server-managed | Current worker does not opt into keeping the audio cache; revisit for real previews or edits. |
| `on_event` callbacks and public event records | Automatic | Progress and actionable warnings; no callback settings. |
| `CancellationToken.cancel()` | Existing cancel action | Preserve job cancellation; internal token checks remain automatic. |
| `CancellationToken.cancelled`, `raise_if_cancelled()` | Automatic/internal | Cancellation status and cooperative execution checks. |
| `list_castings()` | Hidden | Internal stored-cast inspection, not a raw database browser. |
| `remove_casting()`, `remove_attribution()` | Hidden | No cache-reset controls in the conversion flow. |
| `pipe()` | Hidden | Python composition helper; no user-facing option. |
| `magic_run()` | Hidden | Convenience entry point, not an additional Studio mode. |
| `metadata_intent`, `identity`, `style`, `tuning` | Automatic/internal | May feed readable summaries; do not display raw operation objects. |

## Voices and remaining public exports

| Public surface | Decision | Studio treatment |
| --- | --- | --- |
| `list_voices()` | Automatic | Populate existing picker with voices permitted by the server. |
| `add_voice()` | Hidden | Custom voice registration belongs to a separate provisioning feature. |
| `load_voice()` | Hidden, operator-managed | Rendering does not implicitly provision voices. |
| `unload_voice()`, `remove_voice()` | Hidden, operator-managed | Asset lifecycle must not be a per-book preference. |
| `Voice`, `Engine` | Internal records | Show useful voice names/language; engine selection/configuration remains server-owned. |
| `BookInspection`, `BookMetadata`, `ChapterInspection`, `MetadataIntent` | Internal records | Supply current book UI; not independent settings. |
| `CharacterRoster`, `CharacterProfile`, `CastingInspection`, `SpeakerSpan`, `Collision` | Internal records | Support casting and future review, not extra switches. |
| `SeriesRecord`, `SeriesCharacter` | Internal records | Used only if an explicit series workflow is introduced. |
| `Script`, `ScriptRow` | Internal records | Passage review is deferred as above. |
| `ValidationIssue`, `ValidationResult` and result accessors | Automatic | Convert errors/warnings into actionable messages. |
| `Result`, `ExecutionStats` | Automatic/internal | Publish outputs and relevant progress; semantic work counts must not be presented as provider charges. |
| `ExecutionEvent`, `Started`, `StageStarted`, `StageProgress`, `StageCompleted`, `CastResolved`, `Warning`, `Completed` | Automatic/internal | Feed progress/status reporting. |
| `ErrorCode`, `KenkuiError`, `SourceError`, `ValidationError`, `VoiceError`, `ModelError`, `RenderError`, `EncodingError`, `CancelledError` | Automatic/internal | Translate into useful failures and recovery actions. |
| `__version__` | Internal/support | Compatibility and diagnostic information, not a conversion option. |

There is no public `Pipeline.tts()` speed, temperature, pitch, bitrate, or sample-rate parameter in this checkout. Do not invent these controls from private engine configuration. WAV is available through `preview()`; it is not a second full-book format supported by `write()`. Studio should continue respecting server-advertised output formats.

## Smallest UI change and rollout

Keep Book → Voices → Create. Under Voices add collapsed **Pacing** and, in a later slice, **Speech preparation** sections. Retain existing visual styling and controls. The first release can contain only the chapter-pause toggle; other proposals need not delay that fix.

Proposed eventual new toggle set:

1. Pause between chapters — on.
2. Extra pause between paragraphs — off.
3. Prepare numbers for narration — on.
4. Use pronunciation corrections — on.
5. Improve stuttered dialogue — off.

Show effective choices on Create, keep toggles accessible with their labels/descriptions, and save them in drafts. No global expert mode, sliders, or raw JSON.

Required implementation work for chapter pauses:

- Add server-advertised support and durable request/job settings; generated API types alone are insufficient.
- Define a versioned default for new jobs. Preserve existing queued job intent; handle old drafts explicitly rather than silently rewriting queued work.
- Apply pause policy in the common pipeline path before either single-narrator or full-cast rendering returns.
- Persist draft choices, include them in request identity, and refresh preflight when they change.
- Disable/hide the control on unsupported servers; never claim an ignored setting will affect output.
- Verify enabled/disabled payloads, persistence and preflight/render agreement; render two chapters and check gap duration, chapter-marker placement, no trailing silence, and both casting paths.
- Listen across chapter headings, short chapters, dialogue-heavy prose, and a single-chapter selection. No claims of audible quality validation until those auditions happen.

Other speech changes should ship separately after auditioning transformations, including currencies, dates, proper names, hyphenated vocabulary, and non-English voices. This audit reads source and existing tests; it does not report a newly run render or test suite.

## Source anchors

- [Kenkui public exports](../../../kenkui/src/kenkui/__init__.py)
- [Pipeline methods and defaults](../../../kenkui/src/kenkui/pipeline.py)
- [Constructors and convenience functions](../../../kenkui/src/kenkui/api.py)
- [Public API reference](../../../kenkui/docs/api.md)
- [Speech shaping and tuning semantics](../../../kenkui/docs/usage.md)
- [Chapter-gap tests](../../../kenkui/tests/test_pauses_render.py)
- [Server pipeline translation](../../../kenkui-server/src/kenkui_server/jobs/pipeline.py)
- [Server request schema](../../../kenkui-server/src/kenkui_server/api/schemas.py)
- [Server worker](../../../kenkui-server/src/kenkui_server/worker.py)
- [Studio draft/request mapping](../../src/studio/store.ts)
- [Studio composer](../../src/studio/composer.tsx)

Sibling repository links require the adjacent Kenkui and server checkouts.
