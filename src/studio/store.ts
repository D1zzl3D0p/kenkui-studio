import type { BookResponse, JobRequest } from "../api/generated/v1";
export const defaultSpeechSettings = {
  chapterPauses: true,
  prepareNumbers: true,
  pronunciationCorrections: true,
  stutterHandling: false,
};
export type SpeechSettings = typeof defaultSpeechSettings;
export const defaultPauseLengths = {
  chapterPauseMs: "1500",
  scenePauseMs: "0",
  headingBeforePauseMs: "0",
  headingAfterPauseMs: "0",
  paragraphPauseMs: "0",
  linePauseMs: "0",
};
export type PauseLengths = typeof defaultPauseLengths;
/** Which of these a server will actually apply. Absent means an older server. */
export type SettingsSupport = {
  speechSettings?: boolean;
  pauseLengths?: boolean;
  scenePauses?: boolean;
};
const everySetting: SettingsSupport = {
  speechSettings: true,
  pauseLengths: true,
  scenePauses: true,
};
/** Tiers this draft may send, in the order a reader meets them. */
export function pauseFieldsFor(support: SettingsSupport): (keyof PauseLengths)[] {
  const keys = Object.keys(defaultPauseLengths) as (keyof PauseLengths)[];
  return support.scenePauses ? keys : keys.filter((key) => key !== "scenePauseMs");
}
export function validPauseLength(value: string): boolean {
  return /^\d+$/.test(value.trim()) && Number(value) <= 60_000;
}
export function pauseLengthsFor(d: Pick<Draft, "pauseLengths" | "speechSettings">): PauseLengths {
  if (d.pauseLengths) return { ...defaultPauseLengths, ...d.pauseLengths };
  return {
    ...defaultPauseLengths,
    chapterPauseMs: d.speechSettings?.chapterPauses ? "1500" : "0",
  };
}
export type Draft = {
  pauseLengths?: PauseLengths;
  speechSettings?: SpeechSettings;
  id: string;
  book: BookResponse;
  originalSourceId: string;
  title: string;
  author: string;
  chapters: string[];
  narrator: string;
  mode: "single" | "characters";
  model: string;
  unknown: string;
  method: string;
  format: string;
  sourceCover: boolean;
  step: number;
  key: string;
  updated: number;
};
export type Record = {
  id: string;
  sourceId: string;
  title: string;
  author: string;
  narrator: string;
  sourceCover: boolean;
};
export type Library = { drafts: Draft[]; records: Record[] };
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `studio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function requestFor(d: Draft, support: SettingsSupport = everySetting): JobRequest {
  const pauseLengths = d.pauseLengths && pauseLengthsFor(d);
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
export function readLibrary(key: string): Library {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null");
    if (!raw || !Array.isArray(raw.drafts) || !Array.isArray(raw.records))
      return { drafts: [], records: [] };
    return {
      drafts: raw.drafts.filter(
        (d: Draft) =>
          d &&
          typeof d.id === "string" &&
          typeof d.book?.sourceId === "string" &&
          Array.isArray(d.book.chapters) &&
          Array.isArray(d.chapters) &&
          typeof d.key === "string" &&
          typeof d.title === "string" &&
          typeof d.author === "string" &&
          typeof d.narrator === "string" &&
          typeof d.format === "string" &&
          typeof d.model === "string" &&
          typeof d.method === "string" &&
          typeof d.unknown === "string" &&
          typeof d.originalSourceId === "string" &&
          (d.pauseLengths === undefined ||
            (typeof d.pauseLengths === "object" && d.pauseLengths !== null &&
              Object.values(d.pauseLengths).every(
                (value) => typeof value === "string",
              ))) &&
          (d.speechSettings === undefined ||
            (d.speechSettings !== null &&
              Object.keys(defaultSpeechSettings).every(
                (key) => typeof d.speechSettings?.[key as keyof SpeechSettings] === "boolean",
              ))) &&
          [1, 2, 3].includes(d.step) &&
          d.book.chapters.every(
            (c) => c && typeof c.id === "string" && typeof c.title === "string",
          ) &&
          d.chapters.every((c) => typeof c === "string") &&
          ["single", "characters"].includes(d.mode),
      ),
      records: raw.records.filter(
        (r: Record) =>
          r && typeof r.id === "string" && typeof r.title === "string",
      ),
    };
  } catch {
    return { drafts: [], records: [] };
  }
}
