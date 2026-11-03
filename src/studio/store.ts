import type { JobRequest } from "../api/generated/v1";
import { chapterTitlesFor, pauseFieldsFor, pauseLengthsFor, uid, validPauseLength, type Draft, type SettingsSupport } from "./draft-model";
export * from "./draft-model";
export { readLibrary, saveLibrary } from "./draft-storage";

const everySetting: SettingsSupport = { speechSettings: true, pauseLengths: true, scenePauses: true, spokenChapterTitles: true };

export function requestFor(d: Draft, support: SettingsSupport = everySetting): JobRequest {
  const pauseLengths = d.pauseLengths && pauseLengthsFor(d);
  const titles = chapterTitlesFor(d);
  const fields = pauseFieldsFor(support);
  return {
    sourceId: d.book.sourceId,
    chapters: d.chapters,
    casting:
      d.mode === "single"
        ? { voiceId: d.narrator }
        : {
            narratorVoiceId: d.narrator,
            unknownVoiceId: d.unknown || d.narrator,
            method: d.method,
            modelId: d.model,
          },
    tts: {
      normalizeText: true,
      ...(support.spokenChapterTitles ? {
        speakChapterTitles: titles.enabled,
        chapterTitlePauseMs: validPauseLength(titles.pauseMs) ? Number(titles.pauseMs) : 750,
        chapterTitleOverrides: Object.fromEntries(Object.entries(titles.overrides).filter(([id]) => d.chapters.includes(id))),
      } : {}),
      ...(support.speechSettings ? d.speechSettings : undefined),
      ...(support.pauseLengths && pauseLengths &&
        fields.every((key) => validPauseLength(pauseLengths[key]))
        ? Object.fromEntries(fields.map((key) => [key, Number(pauseLengths[key])]))
        : {}),
    },
    output: {
      format: d.format,
      title: d.title.trim() || null,
      author: d.author.trim() || null,
      sourceCover: d.sourceCover,
    },
  };
}
export function changeDraft(d: Draft, patch: Partial<Draft>): Draft {
  const next = { ...d, ...patch, updated: Date.now() };
  if (JSON.stringify(requestFor(d)) !== JSON.stringify(requestFor(next)))
    next.key = uid();
  return next;
}
